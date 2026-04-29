import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

const res: any = await notion.databases.query({
  database_id: NOTION_DB_ID,
  filter: { property: 'status', select: { equals: 'pending' } },
});
let i = 1;
for (const page of res.results) {
  const author = (page.properties.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
  const draft = (page.properties.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  const finalText = (page.properties.final_text?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  const text = (finalText.trim() || draft).trim();
  const url = page.properties.post_url?.url;
  console.log(`\n${i++}. ${author}`);
  console.log(`   POST: ${url}`);
  console.log(`   DRAFT: ${text}`);
}
console.log(`\nTotal pending: ${res.results.length}`);
