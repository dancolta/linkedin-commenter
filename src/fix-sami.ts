import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dbId = process.env.NOTION_DB_ID!;

const res: any = await notion.databases.query({
  database_id: dbId,
  filter: { property: 'status', select: { equals: 'failed' } },
});

const newText = `Everyone i know has a 45-minute-burn story, basically the Claude Code initiation. CLAUDE.md first is what keeps the context tight enough to actually finish. On top of that i've got a separate skill that stress-tests the idea and grills me with edge case questions before i touch code, that's where things actually started clicking honestly. On the CRM bit though, moment someone else needs to log in, you want HubSpot :)`;

for (const page of res.results) {
  await notion.pages.update({
    page_id: page.id,
    properties: {
      draft: { rich_text: [{ text: { content: newText } }] },
      status: { select: { name: 'approved' } },
      reason: { rich_text: [{ text: { content: '' } }] },
    },
  });
  console.log('Fixed + re-approved Sami draft.');
}
