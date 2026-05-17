import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';
import { runDraftPipeline } from '../ai/pipeline.js';
import { getRecentComments } from '../cache/sqlite.js';

const BATCH_SIZE = 6;

async function fetchPending() {
  const out: { pageId: string; author: string; postText: string; oldDraft: string }[] = [];
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
      const postText = (props.post_text?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
      const oldDraft = (props.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
      if (!author || !postText) continue;
      out.push({ pageId: page.id, author, postText, oldDraft });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function setDraft(pageId: string, draft: string) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      draft: { rich_text: [{ text: { content: draft.slice(0, 2000) } }] },
    },
  });
}

const pending = await fetchPending();
console.log(`Found ${pending.length} pending pages. Redrafting in batches of ${BATCH_SIZE} (with QC + 1 retry)...`);
const recent = getRecentComments(20);

let updated = 0, skipped = 0, same = 0;
for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const batch = pending.slice(i, i + BATCH_SIZE);
  const verdicts = await runDraftPipeline(
    batch.map(b => ({ author: b.author, postText: b.postText })),
    { recentComments: recent, logger: (m) => console.log(m) },
  );

  for (let j = 0; j < batch.length; j++) {
    const row = batch[j];
    const v = verdicts[j];
    if (v.status === 'skipped') {
      console.log(`SKIP  ${row.author} — ${v.reason}`);
      skipped++;
      continue;
    }
    if (v.draft === row.oldDraft) {
      console.log(`SAME  ${row.author} (no change)`);
      same++;
      continue;
    }
    await setDraft(row.pageId, v.draft);
    updated++;
    const tag = v.attempts > 1 ? ` [retry ${v.attempts}]` : '';
    console.log(`---`);
    console.log(`AUTHOR: ${row.author}${tag}`);
    console.log(`OLD:    ${row.oldDraft}`);
    console.log(`NEW:    ${v.draft}`);
  }
}

console.log(`\nDone. Updated ${updated}, skipped ${skipped}, unchanged ${same}.`);
