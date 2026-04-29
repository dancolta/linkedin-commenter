import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';
import { validateDraft } from '../ai/guardrails.js';

async function main() {
  const res: any = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: { property: 'status', select: { equals: 'pending' } },
  });

  let kept = 0, archived = 0;
  for (const page of res.results) {
    const author = (page.properties.author?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    const draft = (page.properties.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    const finalText = (page.properties.final_text?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    const text = (finalText.trim() || draft).trim();

    const v = validateDraft(text, []);
    if (!v.ok && v.reason?.startsWith('antithesis')) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archived++;
      console.log(`  ✗ archived (${v.reason}): ${author}`);
      console.log(`     "${text}"`);
    } else if (!v.ok) {
      console.log(`  ⚠ failed other rule (${v.reason}): ${author} — leaving in queue`);
      kept++;
    } else {
      kept++;
      console.log(`  ✓ clean: ${author}`);
    }
  }
  console.log(`\nKept ${kept}, archived ${archived}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
