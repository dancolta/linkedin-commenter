import { launch, sleep, jitter } from './linkedin/browser.js';
import { scrapeFeed, ScrapedPost } from './linkedin/feed-scraper.js';
import { isPaused, AccountPausedError } from './linkedin/safety-check.js';
import { draftBatch, UsageLimitError } from './ai/drafter.js';
import { validateDraft } from './ai/guardrails.js';
import { detectEnglish } from './ai/language.js';
import { createPending, listOpenAuthors } from './notion/queue.js';
import {
  isPostSeen, markPostSeen, commentedAuthorRecently, getRecentComments, getFirstRunAt,
} from './cache/sqlite.js';
import { currentPhase, DRY_RUN, PAUSED_ENV, NOTION_DB_ID } from './config.js';

async function main() {
  if (PAUSED_ENV) { console.log('LINKEDIN_PAUSE=1 — exiting'); process.exit(0); }
  if (isPaused()) { console.log('PAUSED flag set — exiting. Delete ~/.linkedin-commenter/PAUSED to resume.'); process.exit(0); }

  const phase = currentPhase(getFirstRunAt());
  console.log(`Phase cap: scan max ${phase.maxScan}, daily publish cap ${phase.dailyCap}`);

  const counters = { scraped: 0, eligible: 0, drafted: 0, queued: 0, skipped: 0, rejected: 0 };
  const skipReasons: Record<string, number> = {};
  const skip = (reason: string) => { counters.skipped++; skipReasons[reason] = (skipReasons[reason] ?? 0) + 1; };

  // === Phase 1: scrape feed (Chrome open) ===
  console.log('Opening Chrome to scrape feed...');
  const ctx = await launch({ headless: false });
  const page = ctx.pages()[0] ?? await ctx.newPage();

  let posts: ScrapedPost[] = [];
  try {
    posts = await scrapeFeed(page, phase.maxScan);
    counters.scraped = posts.length;
    console.log(`Scraped ${posts.length} posts. Closing Chrome.`);
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

  if (posts.length === 0) {
    console.log('No posts scraped. Check ~/Downloads/linkedin-incident-*.png for screenshot.');
    return;
  }

  // === Phase 2: filter eligible (no Chrome, no Claude) ===
  const openAuthors = await listOpenAuthors();
  const inBatchAuthors = new Set<string>();
  const eligible: ScrapedPost[] = [];
  for (const post of posts) {
    if (!post.text || post.text.length < 50) { skip('post too short'); continue; }
    if (post.isJobOrPoll) { skip('job or poll'); continue; }
    if (post.ageDays !== null && post.ageDays > 7) { skip('post >7 days old'); continue; }
    if (post.commentCount !== null && post.commentCount > 150) { skip('drowned (>150 comments)'); continue; }
    if (isPostSeen(post.postUrl)) { skip('already seen'); continue; }
    if (commentedAuthorRecently(post.author, 14)) { skip('same author <14 days'); continue; }
    const authorKey = post.author.toLowerCase();
    if (inBatchAuthors.has(authorKey)) { skip('duplicate author in this scan'); continue; }
    if (openAuthors.has(authorKey)) { skip('author already pending/approved in Notion'); continue; }
    const lang = detectEnglish(post.text);
    if (!lang.isEnglish) { skip(`non-English (${lang.reason})`); continue; }
    inBatchAuthors.add(authorKey);
    eligible.push(post);
  }
  counters.eligible = eligible.length;

  if (eligible.length === 0) {
    console.log('\n--- Summary ---');
    console.log(`Scraped: ${counters.scraped}, Eligible: 0 (all filtered)`);
    if (Object.keys(skipReasons).length) {
      for (const [r, c] of Object.entries(skipReasons)) console.log(`  ${c}× ${r}`);
    }
    return;
  }

  // === Phase 3: BATCHED drafter (single Claude call for all eligible) ===
  console.log(`\nDrafting ${eligible.length} comments in 1 batched call...`);
  let drafts: string[];
  try {
    drafts = await draftBatch(eligible.map(p => ({ author: p.author, text: p.text })));
    counters.drafted = drafts.filter(d => d && d.trim().toUpperCase() !== 'SKIP').length;
    console.log(`Drafter returned ${drafts.length} drafts (${counters.drafted} substantive, ${drafts.length - counters.drafted} SKIP).`);
  } catch (err) {
    if (err instanceof UsageLimitError) {
      console.error('Usage limit hit. All eligible posts deferred.');
      process.exit(3);
    }
    throw err;
  }

  // === Phase 4: validate + queue (no Chrome, only Notion) ===
  const recent = getRecentComments(20);
  for (let i = 0; i < eligible.length; i++) {
    const post = eligible[i];
    const draft = drafts[i] ?? 'SKIP';
    const trimmed = draft.trim();

    if (trimmed.toUpperCase() === 'SKIP') { skip('drafter returned SKIP'); continue; }

    const validation = validateDraft(trimmed, recent);
    if (!validation.ok) {
      console.log(`  Rejected (${post.author.slice(0, 30)}): ${validation.reason}`);
      counters.rejected++;
      skipReasons[`rejected: ${validation.reason}`] = (skipReasons[`rejected: ${validation.reason}`] ?? 0) + 1;
      continue;
    }

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
        console.log(`  ✓ ${post.author}: ${trimmed.slice(0, 60)}...`);
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
