import { listPending, listApproved } from './queue.js';
import { writeCache } from './review-cache.js';

// Everything still actionable. Under AUTO_APPROVE (the default) drafts land as
// `approved`, so a pending-only listing would always print "nothing to review"
// while ten comments sat one command away from going live.
const active = [...await listApproved(), ...await listPending()];

if (active.length === 0) {
  console.log('No drafts queued. Run `npm run scan` to draft new ones.');
  process.exit(0);
}

const mapping: Record<string, string> = {};
active.forEach((row, idx) => {
  mapping[String(idx + 1)] = row.pageId;
});
writeCache(mapping);

console.log(`\n${active.length} draft${active.length === 1 ? '' : 's'} queued and ready to publish:\n`);

// Markdown table: # | Lead | Post | Draft
// Escape pipes and collapse whitespace so cells render in one row.
const sanitize = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

console.log('| # | Lead | Post | Draft | URL |');
console.log('|---|------|------|-------|-----|');
active.forEach((row, idx) => {
  const id = idx + 1;
  const post = truncate(sanitize(row.postText), 220);
  const draft = sanitize((row.finalText || row.draft).trim());
  const url = row.postUrl ? `[link](${row.postUrl})` : '';
  console.log(`| ${id} | @${sanitize(row.author)} | ${post} | ${draft} | ${url} |`);
});

console.log('\nReply with: post (sends all), remove <name>, or redraft <name>: <feedback>');
