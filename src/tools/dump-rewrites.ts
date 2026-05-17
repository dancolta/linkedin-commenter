// One-off: dump pending rows with draft + final_text + post_text so we can
// extract Dan's voice patterns from his rewrites.
import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

function getText(prop: any): string {
  if (!prop) return '';
  if (prop.type === 'rich_text') return prop.rich_text.map((t: any) => t.plain_text).join('');
  if (prop.type === 'title') return prop.title.map((t: any) => t.plain_text).join('');
  return '';
}

async function main() {
  let cursor: string | undefined;
  const rows: any[] = [];
  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: 'pending' } },
      start_cursor: cursor,
    });
    for (const p of res.results) {
      rows.push({
        author: getText(p.properties.author),
        draft: getText(p.properties.draft),
        final: getText(p.properties.final_text),
        post: getText(p.properties.post_text).slice(0, 500),
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(JSON.stringify(rows, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
