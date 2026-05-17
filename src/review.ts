import { listPending } from './notion/queue.js';
import { writeCache } from './review-cache.js';

const pending = await listPending();

if (pending.length === 0) {
  console.log('No pending drafts. Run `npm run scan` to draft new ones.');
  process.exit(0);
}

const mapping: Record<string, string> = {};
pending.forEach((row, idx) => {
  const id = String(idx + 1);
  mapping[id] = row.pageId;
});
writeCache(mapping);

console.log(`\n${pending.length} pending draft${pending.length === 1 ? '' : 's'}:\n`);

pending.forEach((row, idx) => {
  const id = idx + 1;
  const sourceSnippet = row.postText.replace(/\s+/g, ' ').slice(0, 140);
  const draftText = (row.finalText || row.draft).trim();
  console.log(`#${id}  @${row.author}`);
  console.log(`  Source: "${sourceSnippet}${row.postText.length > 140 ? '…' : ''}"`);
  console.log(`  Draft:  "${draftText}"`);
  if (row.postUrl) console.log(`  URL:    ${row.postUrl}`);
  console.log('');
});

console.log('Reply with: approve <ids|all>, redraft <id>: <feedback>, kill <id>, or publish');
