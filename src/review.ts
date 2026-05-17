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

// Markdown table: # | Lead | Post | Draft
// Escape pipes and collapse whitespace so cells render in one row.
const sanitize = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

console.log('| # | Lead | Post | Draft | URL |');
console.log('|---|------|------|-------|-----|');
pending.forEach((row, idx) => {
  const id = idx + 1;
  const post = truncate(sanitize(row.postText), 220);
  const draft = sanitize((row.finalText || row.draft).trim());
  const url = row.postUrl ? `[link](${row.postUrl})` : '';
  console.log(`| ${id} | @${sanitize(row.author)} | ${post} | ${draft} | ${url} |`);
});

console.log('\nReply with: approve <ids|all>, redraft <id>: <feedback>, kill <id>, or publish');
