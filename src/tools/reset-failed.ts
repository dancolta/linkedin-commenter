import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

async function main() {
  for (const status of ['failed', 'publishing']) {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: status } },
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
      console.log(`  reset ${status} → approved: ${author}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
