import { notion } from './notion/client.js';
import { NOTION_DB_ID } from './config.js';
import { markStatus } from './notion/queue.js';

async function main() {
  let cursor: string | undefined;
  let count = 0;
  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: 'pending' } },
      start_cursor: cursor,
    });
    for (const page of res.results) {
      await markStatus(page.id, 'approved');
      count++;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`Approved ${count} pending drafts.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
