import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';
import { detectEnglish } from '../ai/language.js';

async function main() {
  let cursor: string | undefined;
  let inspected = 0, archived = 0, kept = 0;

  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: 'pending' } },
      start_cursor: cursor,
    });

    for (const page of res.results) {
      inspected++;
      const props = page.properties;
      const author = (props.author?.rich_text ?? []).map((t: any) => t.plain_text).join('');
      const postText = (props.post_text?.rich_text ?? []).map((t: any) => t.plain_text).join('');
      const draft = (props.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('');
      const haystack = `${postText}\n${draft}`.trim();

      const lang = detectEnglish(haystack);
      if (lang.isEnglish) {
        kept++;
        console.log(`  ✓ kept: ${author}`);
      } else {
        await notion.pages.update({ page_id: page.id, archived: true });
        archived++;
        console.log(`  ✗ archived (${lang.reason}): ${author}`);
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  console.log(`\nInspected ${inspected}, kept ${kept}, archived ${archived}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
