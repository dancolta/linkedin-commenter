import { Client } from '@notionhq/client';
import 'dotenv/config';
async function main() {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const dbId = process.env.NOTION_DB_ID!;
  const res = await notion.databases.query({
    database_id: dbId,
    filter: { property: 'status', select: { equals: 'deferred' } },
    page_size: 100,
  });
  console.log(`Found ${res.results.length} deferred drafts.`);
  for (const page of res.results as any[]) {
    await notion.pages.update({ page_id: page.id, properties: { status: { select: { name: 'approved' } } } });
  }
  console.log(`Re-approved ${res.results.length}.`);
}
main();
