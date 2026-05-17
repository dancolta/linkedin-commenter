/**
 * One-shot cleanup: iterate all pending Notion rows, navigate to each post,
 * and archive any where Dan already left a comment manually.
 *
 * Run when you suspect the scan-time dedupe guard missed something, or after
 * a bug fix that introduced the guard.
 */
import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';
import { launch, sleep, jitter } from '../linkedin/browser.js';
import { detectMyVanity } from '../linkedin/identity.js';
import { checkIAlreadyCommented } from '../linkedin/commenter.js';
import { markStatus, archivePage } from '../notion/queue.js';
import { markPostSeen } from '../cache/sqlite.js';

interface PendingRow {
  pageId: string;
  author: string;
  postUrl: string;
}

async function fetchPending(): Promise<PendingRow[]> {
  const out: PendingRow[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: 'pending' } },
      start_cursor: cursor,
    });
    for (const page of res.results) {
      const props = page.properties;
      const author = (props.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
      const postUrl = props.post_url?.url ?? '';
      if (!author || !postUrl) continue;
      out.push({ pageId: page.id, author, postUrl });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

const rows = await fetchPending();
if (rows.length === 0) {
  console.log('No pending rows. Nothing to clean.');
  process.exit(0);
}

console.log(`Found ${rows.length} pending row${rows.length === 1 ? '' : 's'}. Opening Chrome...`);
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? await ctx.newPage();

let archived = 0;
let kept = 0;
let errors = 0;
try {
  const myVanity = await detectMyVanity(page);
  if (!myVanity) {
    console.error('Could not detect identity. Set MY_LINKEDIN_VANITY. Aborting.');
    process.exit(2);
  }
  console.log(`Identity: /in/${myVanity}/`);

  for (const row of rows) {
    try {
      const already = await checkIAlreadyCommented(page, row.postUrl, myVanity);
      if (already) {
        await markStatus(row.pageId, 'skipped', { reason: 'you already commented on this post (cleanup)' });
        await archivePage(row.pageId);
        markPostSeen(row.postUrl, row.author);
        archived++;
        console.log(`  ⊘ archived: ${row.author}`);
      } else {
        kept++;
        console.log(`  ✓ kept:     ${row.author}`);
      }
    } catch (err) {
      errors++;
      console.log(`  ✗ error on ${row.author}: ${(err as Error).message}`);
    }
    await sleep(jitter(800, 1500));
  }
} finally {
  await ctx.close().catch(() => {});
}

console.log(`\nDone. Archived ${archived}, kept ${kept}, errors ${errors}.`);
