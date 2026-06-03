import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPostText } from './notion/queue.js';
import { readCache } from './review-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOOD_PATH = join(__dirname, 'ai', 'good-drafts.md');
const MAX_ENTRIES = 25;

const HEADER = `# Good drafts — vibe reference (NOT structural templates)
#
# Auto-appended by \`npm run good -- "<ids>"\` after \`npm run review\`.
# Drafter injects a random 3 of N entries each run as vibe reference.
# FIFO at ${MAX_ENTRIES} entries — oldest dropped automatically.
#
# Format per entry:
#   ## YYYY-MM-DD · re @<author> on <topic>
#   <comment text>
`;

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) {
  console.error('Usage: npm run good -- "<ids>"   (e.g. "5,17" — IDs from `npm run review`)');
  process.exit(1);
}

const cache = readCache();
if (!cache) {
  console.error('No review cache found. Run `npm run review` first.');
  process.exit(1);
}

const ids = arg.split(',').map(s => s.trim()).filter(Boolean);
const resolved: { id: string; pageId: string }[] = [];
const missing: string[] = [];
for (const id of ids) {
  const pid = cache.mapping[id];
  if (pid) resolved.push({ id, pageId: pid });
  else missing.push(id);
}
if (missing.length) {
  console.error(`Unknown IDs: ${missing.join(', ')}. Re-run \`npm run review\` to refresh.`);
  process.exit(1);
}

if (!existsSync(GOOD_PATH)) {
  writeFileSync(GOOD_PATH, HEADER, 'utf8');
}

const date = new Date().toISOString().slice(0, 10);
const entries: string[] = [];

for (const { id, pageId } of resolved) {
  const { author, postText, oldDraft } = await getPostText(pageId);
  if (!oldDraft) {
    console.warn(`#${id} (${author}) has no draft — skipped.`);
    continue;
  }
  const topic = topicFromPost(postText);
  const entry = `\n## ${date} · re @${author} on ${topic}\n${oldDraft}\n`;
  entries.push(entry);
  console.log(`+ #${id} @${author}`);
}

if (entries.length === 0) {
  console.log('No entries added.');
  process.exit(0);
}

appendFileSync(GOOD_PATH, entries.join(''), 'utf8');

const trimmed = enforceFifo(GOOD_PATH, MAX_ENTRIES);
console.log(`Added ${entries.length} to good-drafts.md (${trimmed} total entries kept).`);

function topicFromPost(text: string): string {
  const first = text.split(/[.!?\n]/).map(s => s.trim()).find(Boolean) ?? '';
  return first.slice(0, 60).replace(/\s+/g, ' ') || 'unspecified';
}

function enforceFifo(path: string, max: number): number {
  const content = readFileSync(path, 'utf8');
  const headerEnd = content.indexOf('\n## ');
  if (headerEnd === -1) return 0;
  const header = content.slice(0, headerEnd);
  const body = content.slice(headerEnd);
  const parts = body.split(/(?=\n## )/).filter(s => s.trim());
  if (parts.length <= max) return parts.length;
  const kept = parts.slice(parts.length - max);
  writeFileSync(path, header + kept.join(''), 'utf8');
  return kept.length;
}
