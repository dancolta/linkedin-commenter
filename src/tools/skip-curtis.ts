import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';
import { markStatus } from '../notion/queue.js';

async function main() {
  const res = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: { property: 'status', select: { equals: 'pending' } },
  });
  for (const p of res.results as any[]) {
    const author = (p.properties.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
    const skip = /curtis\s+matsko/i.test(author);
    const next = skip ? 'skipped' : 'approved';
    console.log(`${author} -> ${next}`);
    await markStatus(p.id, next as any, skip ? { reason: 'manually rejected by Dan' } : undefined);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
