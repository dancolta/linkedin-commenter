import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

async function main() {
  const res: any = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: { property: 'status', select: { equals: 'pending' } },
  });

  const seenAuthors = new Map<string, string>();
  let archivedDash = 0, archivedDup = 0, kept = 0;

  for (const page of res.results) {
    const props = page.properties;
    const author = (props.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
    const draft = (props.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    const finalText = (props.final_text?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    const text = (finalText.trim() || draft).trim();

    if (/[—–]/.test(text)) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archivedDash++;
      console.log(`  ✗ em-dash: ${author}`);
      continue;
    }

    const key = author.toLowerCase();
    if (seenAuthors.has(key)) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archivedDup++;
      console.log(`  ✗ duplicate author (kept earlier): ${author}`);
      continue;
    }
    seenAuthors.set(key, page.id);
    kept++;
    console.log(`  ✓ kept: ${author}`);
  }

  console.log(`\nKept ${kept}, archived em-dash ${archivedDash}, archived duplicates ${archivedDup}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
