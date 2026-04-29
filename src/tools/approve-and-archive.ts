import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

const ARCHIVE_AUTHORS = (process.env.ARCHIVE_AUTHORS ?? '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean);

async function main() {
  const res: any = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: {
      or: [
        { property: 'status', select: { equals: 'pending' } },
        { property: 'status', select: { equals: 'deferred' } },
      ],
    },
  });

  let approved = 0, archived = 0;
  for (const page of res.results) {
    const author = (page.properties.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
    const key = author.toLowerCase();
    if (ARCHIVE_AUTHORS.some(a => key.includes(a))) {
      await notion.pages.update({ page_id: page.id, archived: true });
      archived++;
      console.log(`  archived: ${author}`);
    } else {
      await notion.pages.update({ page_id: page.id, properties: { status: { select: { name: 'approved' } } } });
      approved++;
      console.log(`  approved: ${author}`);
    }
  }
  console.log(`\nApproved ${approved}, archived ${archived}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
