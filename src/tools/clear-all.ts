import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

async function main() {
  let cursor: string | undefined;
  let archived = 0;
  do {
    const res: any = await notion.databases.query({ database_id: NOTION_DB_ID, start_cursor: cursor });
    for (const page of res.results) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archived += 1;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`Archived ${archived} pages from Notion DB`);
}

main().catch(err => { console.error(err); process.exit(1); });
