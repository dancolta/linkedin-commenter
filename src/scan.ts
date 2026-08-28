import { launch, sleep, jitter } from './linkedin/browser.js';
import { scrapeFeed, ScrapedPost } from './linkedin/feed-scraper.js';
import { isPaused, AccountPausedError } from './linkedin/safety-check.js';
import { detectMyVanity } from './linkedin/identity.js';
import { checkIAlreadyCommented } from './linkedin/commenter.js';
import { UsageLimitError, AuthError } from './ai/drafter.js';
import { runDraftPipeline } from './ai/pipeline.js';
import { detectEnglish } from './ai/language.js';
import { createPending, listOpenAuthors } from './queue.js';
import { syncVault } from './vault/sync.js';
import {
  isPostSeen, markPostSeen, commentedAuthorRecently, getRecentComments, getFirstRunAt,
} from './cache/sqlite.js';
import {
  currentPhase, DRY_RUN, PAUSED_ENV,
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
    const scanOverride = parseInt(process.env.MAX_SCAN ?? '', 10);
    const scanCap = Number.isFinite(scanOverride) && scanOverride > 0 ? scanOverride : phase.maxScan;
    posts = await scrapeFeed(page, scanCap);
    counters.scraped = posts.length;
    console.log(`Scraped ${posts.length} posts from feed.`);

    if (posts.length === 0) {
      console.log('No posts scraped. Check ~/Downloads/linkedin-incident-*.png for screenshot.');
      return;
    }

    // Phase 0b: profile-walk for priority authors.
    // The feed alone won't reliably surface all 20 priority creators in a single scan,
    // so we actively visit a randomized subset of their profiles and pick up posts ≤1 day old.
    // Pacing + cap is set conservatively: 10 profiles per scan, 45-120s between visits,
    // randomized order so the same authors aren't walked in the same sequence daily.
    // Set PRIORITY_PROFILES_PER_SCAN=0 to disable; PRIORITY_PROFILES_PER_SCAN=N to override.
    const profileBudget = parseInt(process.env.PRIORITY_PROFILES_PER_SCAN ?? '10', 10);
    if (profileBudget > 0) {
      const { PRIORITY_PROFILES } = await import('./priority-authors.js');
      const { scrapeAuthorProfile, shuffle } = await import('./linkedin/profile-scraper.js');
      const walkable = PRIORITY_PROFILES.filter(p => p.slug);
      const order = shuffle(walkable).slice(0, profileBudget);
      console.log(`Profile-walk: visiting ${order.length} priority author profile${order.length === 1 ? '' : 's'} (${walkable.length - order.length} held back, will cycle next scan).`);
      const knownUrns = new Set(posts.map(p => p.postUrl));
      let added = 0;
      for (const { name, slug } of order) {
        try {
          const found = await scrapeAuthorProfile(page, slug!, { maxPosts: 1, maxAgeDays: 1 });
          for (const post of found) {
            if (knownUrns.has(post.postUrl)) continue;
            knownUrns.add(post.postUrl);
            posts.push(post);
            added++;
            console.log(`  + ${name}: ${post.text.slice(0, 60)}...`);
          }
          if (found.length === 0) {
            console.log(`  · ${name}: no fresh post (≤1 day) on profile`);
          }
        } catch (err) {
          // LOGIN_REQUIRED and similar safety errors bubble up through profile-scraper.ts.
          // We treat it the same as the feed-scrape safety path: abort the whole scan.
          if ((err as Error).message?.includes('LOGIN_REQUIRED')) {
            throw new AccountPausedError('LOGIN_REQUIRED on profile-walk');
          }
          console.log(`  ✗ ${name}: profile-walk failed (${(err as Error).message?.slice(0, 80)})`);
        }
        await sleep(jitter(45_000, 120_000)); // human pacing between profile visits
      }
      console.log(`Profile-walk done: +${added} posts. Total candidate posts: ${posts.length}.`);
      counters.scraped = posts.length; // refresh counter to include profile-walk
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
      if (openAuthors.has(authorKey)) { skip('author already pending/approved in queue'); continue; }
      const lang = detectEnglish(post.text);
      if (!lang.isEnglish) { skip(`non-English (${lang.reason})`); continue; }
      inBatchAuthors.add(authorKey);
      prefiltered.push(post);
    }

    // Phase 1b: for each remaining post, navigate and verify Dan hasn't manually commented.
    // This is the strongest guard against double-commenting and runs BEFORE anything is queued.
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
    // Sort priority authors to the front so they're drafted/queued first.
    const { isPriorityAuthor } = await import('./priority-authors.js');
    eligible.sort((a, b) => Number(isPriorityAuthor(b.author)) - Number(isPriorityAuthor(a.author)));
    const priorityHits = eligible.filter(p => isPriorityAuthor(p.author)).length;
    if (priorityHits > 0) console.log(`Priority authors in this batch: ${priorityHits} (sorted to front).`);
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
    printSummary(counters, skipReasons);
    return;
  }

  // Escape hatch: when DUMP_ELIGIBLE is set, dump eligible posts to JSON and exit
  // before invoking the `claude -p` subprocess. Used when running scan from inside
  // a Claude Code session (where the subprocess 401s) — caller drafts externally.
  if (process.env.DUMP_ELIGIBLE) {
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.DUMP_ELIGIBLE, JSON.stringify(eligible, null, 2));
    console.log(`\nDumped ${eligible.length} eligible posts to ${process.env.DUMP_ELIGIBLE}`);
    printSummary(counters, skipReasons);
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
    if (err instanceof AuthError) {
      console.error('NOT AUTHENTICATED — the `claude` CLI could not start a session, so nothing was drafted.');
      console.error('Run `claude login`, then re-run the scan. No posts were marked seen.');
      process.exit(4);
    }
    throw err;
  }
  counters.drafted = verdicts.filter(v => v.status === 'queued').length;
  console.log(`Pipeline finished: ${counters.drafted} passed QC, ${verdicts.length - counters.drafted} skipped.`);

  // === Phase 4: queue drafts ===
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
        console.log(`  ✗ Queue error for ${post.author}: ${(err as Error).message}`);
        skip('queue error');
      }
    }
  }

  printSummary(counters, skipReasons);
  if (counters.queued > 0) {
    console.log(`\nAll queued drafts are pre-approved. Skim them in LinkedIn/Comments and delete any note you don't want out — everything left publishes on the next post run.`);
  }

  // Mirror the live pending queue into the Obsidian vault (wipe + rebuild).
  // Never let a vault hiccup fail the scan.
  if (!DRY_RUN) {
    try {
      await syncVault();
    } catch (err) {
      console.log(`Vault sync skipped: ${(err as Error).message}`);
    }
  }
}

type Counters = { scraped: number; eligible: number; drafted: number; queued: number; skipped: number; rejected: number };

function printSummary(c: Counters, skipReasons: Record<string, number>) {
  const rows: [string, number | string][] = [
    ['Scanned', c.scraped],
    ['Skipped (filtered)', c.skipped],
    ['Passed filters', c.eligible],
    ['Substantive drafts', c.drafted],
    ['Rejected by guardrails/QC', c.rejected],
    ['Queued', c.queued],
  ];
  const labelW = Math.max(...rows.map(([l]) => l.length));
  const valW = Math.max(...rows.map(([, v]) => String(v).length), 5);
  const line = `+-${'-'.repeat(labelW)}-+-${'-'.repeat(valW)}-+`;
  console.log('\n--- Scan Summary ---');
  console.log(line);
  console.log(`| ${'Metric'.padEnd(labelW)} | ${'Count'.padStart(valW)} |`);
  console.log(line);
  for (const [label, val] of rows) {
    console.log(`| ${label.padEnd(labelW)} | ${String(val).padStart(valW)} |`);
  }
  console.log(line);

  if (Object.keys(skipReasons).length) {
    console.log('\nSkip breakdown:');
    const reasons = Object.entries(skipReasons).sort((a, b) => b[1] - a[1]);
    const rW = Math.max(...reasons.map(([r]) => r.length));
    for (const [r, n] of reasons) console.log(`  ${String(n).padStart(3)} × ${r.padEnd(rW)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
