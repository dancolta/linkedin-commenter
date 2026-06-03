import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dbId = process.env.NOTION_DB_ID!;

const res: any = await notion.databases.query({
  database_id: dbId,
  filter: {
    and: [
      { property: 'status', select: { equals: 'failed' } },
      { property: 'reason', rich_text: { contains: 'too long' } },
    ],
  },
});

for (const page of res.results) {
  const author = (page.properties.author?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  await notion.pages.update({
    page_id: page.id,
    properties: {
      status: { select: { name: 'approved' } },
      reason: { rich_text: [{ text: { content: '' } }] },
    },
  });
  console.log(`Re-approved @${author}`);
}
console.log(`Done. ${res.results.length} re-approved.`);
