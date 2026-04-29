import { launch, sleep, jitter } from './linkedin/browser.js';
import { checkAccountHealth, isPaused, AccountPausedError, writePauseFlag } from './linkedin/safety-check.js';
import { publishComment, likePost, CommentPublishError } from './linkedin/commenter.js';
import { listApproved, markStatus, archivePage } from './notion/queue.js';
import { validateDraft } from './ai/guardrails.js';
import {
  getFirstRunAt, getDailyPublished, incrementDailyPublished, recordAuthorComment,
  recordPublishedComment, getRecentComments, commentedAuthorRecently, recordFailure, clearRecentFailures,
} from './cache/sqlite.js';
import { currentPhase, DRY_RUN, PAUSED_ENV } from './config.js';

async function main() {
  if (PAUSED_ENV) { console.log('LINKEDIN_PAUSE=1 — exiting'); process.exit(0); }
  if (isPaused()) { console.log('PAUSED flag set. Delete ~/.linkedin-commenter/PAUSED to resume.'); process.exit(0); }

  const phase = currentPhase(getFirstRunAt());
  const alreadyToday = getDailyPublished();
  const remaining = Math.max(0, phase.dailyCap - alreadyToday);
  console.log(`Daily cap: ${phase.dailyCap}, published today: ${alreadyToday}, remaining: ${remaining}`);

  if (remaining === 0) {
    console.log('Daily cap reached. Exiting without action.');
    process.exit(0);
  }

  const approved = await listApproved();
  console.log(`Found ${approved.length} approved drafts in Notion`);
  if (approved.length === 0) process.exit(0);

  const ctx = await launch({ headless: false });
  const page = ctx.pages()[0] ?? await ctx.newPage();

  let publishedCount = 0;
  let failedCount = 0;
  let deferredCount = 0;

  try {
    if (!DRY_RUN) {
      console.log('Running pre-publish account health check...');
      await checkAccountHealth(page);
    }

    for (const row of approved) {
      if (publishedCount >= remaining) {
        console.log(`Daily cap reached mid-batch. Marking remaining ${approved.length - publishedCount - failedCount - deferredCount} as deferred.`);
        for (const r of approved.slice(approved.indexOf(row))) {
          await markStatus(r.pageId, 'deferred', { reason: 'daily cap reached' });
          deferredCount++;
        }
        break;
      }

      const text = (row.finalText && row.finalText.trim()) || row.draft;

      if (commentedAuthorRecently(row.author, 14)) {
        await markStatus(row.pageId, 'skipped', { reason: 'commented on this author within 14 days' });
        continue;
      }

      const recent = getRecentComments(20);
      const v = validateDraft(text, recent);
      if (!v.ok) {
        await markStatus(row.pageId, 'failed', { reason: `guardrail: ${v.reason}` });
        failedCount++;
        continue;
      }

      console.log(`\n  Publishing to ${row.author}: "${text.slice(0, 60)}..."`);

      if (DRY_RUN) {
        console.log('  [DRY] would publish');
        await markStatus(row.pageId, 'published', { publishedAt: new Date() });
        await archivePage(row.pageId);
        recordPublishedComment(text);
        recordAuthorComment(row.author);
        incrementDailyPublished();
        publishedCount++;
        continue;
      }

      try {
        await markStatus(row.pageId, 'publishing');
        const result = await publishComment(page, row.postUrl, text);
        await markStatus(row.pageId, 'published', { publishedAt: new Date() });
        await archivePage(row.pageId);
        recordPublishedComment(text);
        recordAuthorComment(row.author);
        incrementDailyPublished();
        publishedCount++;
        console.log(`  ✓ Published + archived${result.liked ? ' (liked)' : ` (no like: ${result.likeReason})`}`);
        clearRecentFailures();
      } catch (err) {
        const msg = err instanceof CommentPublishError ? err.message : (err as Error).message;
        await markStatus(row.pageId, 'failed', { reason: msg });
        failedCount++;
        console.log(`  ✗ Failed: ${msg}`);
        const recent = recordFailure(msg);
        if (recent >= 3) {
          writePauseFlag(`3+ publish failures in last hour, last: ${msg}`);
          console.error('3 failures in last hour — wrote PAUSED flag.');
          break;
        }
      }

      if (publishedCount < remaining) {
        const gap = jitter(phase.minGapMs, phase.maxGapMs);
        console.log(`  Sleeping ${Math.round(gap / 1000)}s before next...`);
        await sleep(gap);
      }
    }
  } catch (err) {
    if (err instanceof AccountPausedError) {
      console.error(`ACCOUNT PAUSED: ${err.signal}`);
      process.exit(2);
    }
    throw err;
  } finally {
    await ctx.close();
  }

  console.log('\n--- Summary ---');
  console.log(`Published: ${publishedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Deferred: ${deferredCount}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
