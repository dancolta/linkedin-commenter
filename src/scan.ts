import { launch, sleep, jitter } from './linkedin/browser.js';
import { scrapeFeed, ScrapedPost } from './linkedin/feed-scraper.js';
import { isPaused, AccountPausedError } from './linkedin/safety-check.js';
import { detectMyVanity } from './linkedin/identity.js';
import { checkIAlreadyCommented } from './linkedin/commenter.js';
import { UsageLimitError } from './ai/drafter.js';
import { runDraftPipeline } from './ai/pipeline.js';
import { detectEnglish } from './ai/language.js';
import { createPending, listOpenAuthors } from './notion/queue.js';
import {
  isPostSeen, markPostSeen, commentedAuthorRecently, getRecentComments, getFirstRunAt,
} from './cache/sqlite.js';
import {
  currentPhase, DRY_RUN, PAUSED_ENV, NOTION_DB_ID,
  ONLY_AUTHORS, SKIP_AUTHORS, ONLY_KEYWORDS, SKIP_KEYWORDS,
} from './config.js';

async function main() {
  if (PAUSED_ENV) { console.log('LINKEDIN_PAUSE=1 — exiting'); process.exit(0); }
  if (isPaused()) { console.log('PAUSED flag set — exiting. Delete ~/.linkedin-engage/PAUSED to resume.'); process.exit(0); }

  const phase = currentPhase(getFirstRunAt());
  console.log(`Phase cap: scan max ${phase.maxScan}, daily publish cap ${phase.dailyCap}`);

  const counters = { scraped: 0, eligible: 0, drafted: 0, queued: 0, skipped: 0, rejected: 0 };
  const skipReasons: Record<string, number> = {};
  const skip = (reason: string) => { counters.skipped++; skipReasons[reason] = (skipReasons[reason] ?? 0) + 1; };

  const maxAgeDays = parseInt(process.env.MAX_POST_AGE_DAYS ?? '4', 10);

  // === Phase 1: scrape feed + verify Dan hasn't already commented ===
  console.log('Launching Chrome (headless by default; LINKEDIN_HEADED=1 to watch)...');
  const ctx = await launch();
  const page = ctx.pages()[0] ?? await ctx.newPage();

  let posts: ScrapedPost[] = [];
  let eligible: ScrapedPost[] = [];
  try {
    posts = await scrapeFeed(page, phase.maxScan);
    counters.scraped = posts.length;
    console.log(`Scraped ${posts.length} posts.`);

    if (posts.length === 0) {
      console.log('No posts scraped. Check ~/Downloads/linkedin-incident-*.png for screenshot.');
      return;
    }

    // Identity is mandatory — without it, we cannot enforce the manual-comment guard.
    const myVanity = await detectMyVanity(page);
    if (!myVanity) {
      console.error('Could not detect LinkedIn identity (/in/me/). Set MY_LINKEDIN_VANITY in .env. Aborting — manual-comment guard cannot be enforced.');
      process.exit(2);
    }
    console.log(`Identity: /in/${myVanity}/ — will skip any post you already commented on.`);

    // Phase 1a: cheap pre-filters (no extra page loads).
    const openAuthors = await listOpenAuthors();
    const inBatchAuthors = new Set<string>();
    const prefiltered: ScrapedPost[] = [];
    for (const post of posts) {
      if (!post.text || post.text.length < 50) { skip('post too short'); continue; }
      if (post.isJobOrPoll) { skip('job or poll'); continue; }
      if (post.ageDays !== null && post.ageDays > maxAgeDays) { skip(`post >${maxAgeDays} days old`); continue; }
      if (post.commentCount !== null && post.commentCount > 150) { skip('drowned (>150 comments)'); continue; }
      if (isPostSeen(post.postUrl)) { skip('already seen'); continue; }
      if (commentedAuthorRecently(post.author, 14)) { skip('same author <14 days'); continue; }
      const authorKey = post.author.toLowerCase();
      if (SKIP_AUTHORS.length && SKIP_AUTHORS.some(a => authorKey.includes(a))) { skip('author on SKIP_AUTHORS list'); continue; }
      if (ONLY_AUTHORS.length && !ONLY_AUTHORS.some(a => authorKey.includes(a))) { skip('author not on ONLY_AUTHORS list'); continue; }
      const textKey = post.text.toLowerCase();
      if (SKIP_KEYWORDS.length && SKIP_KEYWORDS.some(k => textKey.includes(k))) { skip('post matches SKIP_KEYWORDS'); continue; }
      if (ONLY_KEYWORDS.length && !ONLY_KEYWORDS.some(k => textKey.includes(k))) { skip('post does not match ONLY_KEYWORDS'); continue; }
      if (inBatchAuthors.has(authorKey)) { skip('duplicate author in this scan'); continue; }
      if (openAuthors.has(authorKey)) { skip('author already pending/approved in Notion'); continue; }
      const lang = detectEnglish(post.text);
      if (!lang.isEnglish) { skip(`non-English (${lang.reason})`); continue; }
      inBatchAuthors.add(authorKey);
      prefiltered.push(post);
    }

    // Phase 1b: for each remaining post, navigate and verify Dan hasn't manually commented.
    // This is the strongest guard against double-commenting and runs BEFORE Notion is touched.
    if (prefiltered.length > 0) {
      console.log(`\nChecking ${prefiltered.length} eligible post${prefiltered.length === 1 ? '' : 's'} for existing comments by you...`);
      for (const post of prefiltered) {
        const already = await checkIAlreadyCommented(page, post.postUrl, myVanity);
        if (already) {
          console.log(`  ⊘ ${post.author.slice(0, 30)} — you already commented on this post`);
          skip('you already commented (manual or prior bot run)');
          markPostSeen(post.postUrl, post.author); // never resurface
          continue;
        }
        eligible.push(post);
        await sleep(jitter(800, 1500)); // human pacing between page loads
      }
    }
    counters.eligible = eligible.length;
    console.log(`Eligible after dedupe checks: ${eligible.length}. Closing Chrome.`);
  } catch (err) {
    if (err instanceof AccountPausedError) {
      console.error(`ACCOUNT PAUSED: ${err.signal}`);
      await ctx.close().catch(() => {});
      process.exit(2);
    }
    await ctx.close().catch(() => {});
    throw err;
  } finally {
    await ctx.close().catch(() => {});
  }

  if (eligible.length === 0) {
    console.log('\n--- Summary ---');
    console.log(`Scraped: ${counters.scraped}, Eligible: 0 (all filtered)`);
    if (Object.keys(skipReasons).length) {
      for (const [r, c] of Object.entries(skipReasons)) console.log(`  ${c}× ${r}`);
    }
    return;
  }

  // === Phase 3: drafter + QC pipeline (evaluator-optimizer with 1 retry on fail) ===
  console.log(`\nDrafting + QC on ${eligible.length} comments...`);
  const recent = getRecentComments(20);
  let verdicts;
  try {
    verdicts = await runDraftPipeline(
      eligible.map(p => ({ author: p.author, postText: p.text })),
      { recentComments: recent, logger: (m) => console.log(m) },
    );
  } catch (err) {
    if (err instanceof UsageLimitError) {
      console.error('Usage limit hit. All eligible posts deferred.');
      process.exit(3);
    }
    throw err;
  }
  counters.drafted = verdicts.filter(v => v.status === 'queued').length;
  console.log(`Pipeline finished: ${counters.drafted} passed QC, ${verdicts.length - counters.drafted} skipped.`);

  // === Phase 4: queue to Notion ===
  for (let i = 0; i < eligible.length; i++) {
    const post = eligible[i];
    const v = verdicts[i];

    if (v.status === 'skipped') {
      const bucket = v.reason.startsWith('QC:') ? 'rejected by QC'
        : v.reason.startsWith('guardrail:') ? 'rejected by guardrails'
        : v.reason;
      if (bucket === 'rejected by QC' || bucket === 'rejected by guardrails') counters.rejected++;
      skip(bucket);
      if (v.lastDraft) console.log(`  ✗ ${post.author.slice(0, 30)}: ${v.reason}`);
      continue;
    }

    const trimmed = v.draft;
    if (DRY_RUN) {
      console.log(`  [DRY] ${post.author}: ${trimmed}`);
    } else {
      try {
        await createPending({
          author: post.author,
          postUrl: post.postUrl,
          postText: post.text,
          draft: trimmed,
        });
        markPostSeen(post.postUrl, post.author);
        counters.queued++;
        const tag = v.attempts > 1 ? ` [retry ${v.attempts}]` : '';
        console.log(`  ✓ ${post.author}${tag}: ${trimmed.slice(0, 60)}...`);
      } catch (err) {
        console.log(`  ✗ Notion error for ${post.author}: ${(err as Error).message}`);
        skip('notion error');
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Scraped: ${counters.scraped}`);
  console.log(`Eligible (passed filters): ${counters.eligible}`);
  console.log(`Substantive drafts: ${counters.drafted}`);
  console.log(`Queued to Notion: ${counters.queued}`);
  console.log(`Rejected by guardrails: ${counters.rejected}`);
  console.log(`Filtered/skipped: ${counters.skipped}`);
  if (Object.keys(skipReasons).length) {
    for (const [r, c] of Object.entries(skipReasons)) console.log(`  ${c}× ${r}`);
  }
  if (counters.queued > 0) {
    const dbSlug = NOTION_DB_ID.replace(/-/g, '');
    console.log(`\nReview & approve in Notion: https://www.notion.so/${dbSlug}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
