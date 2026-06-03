import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dbId = process.env.NOTION_DB_ID!;

const res: any = await notion.databases.query({
  database_id: dbId,
  filter: { property: 'status', select: { equals: 'failed' } },
});

for (const page of res.results) {
  const props = page.properties;
  const author = (props.author?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  const reason = (props.reason?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  const draft = (props.draft?.rich_text ?? []).map((t: any) => t.plain_text).join('');
  console.log(`@${author}\n  reason: ${reason || '(none)'}\n  draft: ${draft.slice(0, 100)}...\n`);
}
