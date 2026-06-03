import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { listPending, QueueRow } from '../notion/queue.js';

// Obsidian "dan-brain" vault — LinkedIn comment drafts mirror.
// Override with LINKEDIN_VAULT_DIR to point at a different Comments folder.
const DEFAULT_COMMENTS_DIR = join(
  homedir(),
  'Work', 'NodeSparks', 'Projects', 'dan-brain',
  'wiki', 'Marketing', 'LinkedIn', 'Comments',
);

export function commentsDir(): string {
  return process.env.LINKEDIN_VAULT_DIR || DEFAULT_COMMENTS_DIR;
}

const INDEX_FILE = 'Comments.md';

/** Today's date as YYYY-MM-DD in Europe/Madrid (matches scanned_at semantics elsewhere). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Strip characters Obsidian/macOS can't put in a filename. Keeps the em dash. */
function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Short human subject derived from the first meaningful line of the post. */
function deriveSubject(postText: string): string {
  const firstLine = postText
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0) ?? 'LinkedIn post';
  const cleaned = firstLine.replace(/[#*_>`]/g, '').trim();
  const words = cleaned.split(/\s+/).slice(0, 9).join(' ');
  return (words.length < cleaned.length ? `${words}…` : words).slice(0, 80);
}

/** Deterministic 6-digit address slug from the Notion page id. */
function addressFor(pageId: string): string {
  const hex = createHash('sha1').update(pageId).digest('hex').slice(0, 6);
  const n = parseInt(hex, 16) % 1_000_000;
  return `c-${String(n).padStart(6, '0')}`;
}

function noteBody(row: QueueRow, subject: string, scannedAt: string): string {
  const fmTitle = `${row.author} — ${subject}`.replace(/"/g, "'");
  return `---
type: linkedin-comment
title: "${fmTitle}"
status: pending
scanned_at: ${scannedAt}
address: ${addressFor(row.pageId)}
author: ${row.author}
post_url: "${row.postUrl}"
tags: [linkedin, comment, channel/linkedin, pending, draft]
---

# ${row.author} — ${subject}

## My draft reply

${row.draft.trim()}

## Original post

${row.postText.trim()}

---

[[LinkedIn]]


[[Marketing]]
`;
}

function buildIndex(rows: Array<{ row: QueueRow; subject: string; noteName: string }>, scannedAt: string): string {
  const header = `---
type: index
title: "LinkedIn Comments"
status: living-doc
created: 2026-06-03
updated: ${scannedAt}
tags: [linkedin, comments, index, channel/linkedin]
---

# LinkedIn Comments Queue

Comment drafts queued for review before publishing. Status flow: \`pending\` → \`approved\` → \`publishing\` → \`published\` (or \`failed\` / \`skipped\` / \`deferred\`).

Workflow: scraped post → auto-drafted reply (in Dan's voice via \`/linkedin-engage\`) → manual approval here → published via Playwright. This folder is rebuilt from the live pending queue on every \`/linkedin-engage run\`.

## Pending drafts
`;

  if (rows.length === 0) {
    return `${header}\n_No pending drafts. Run \`/linkedin-engage\` to scan and queue._\n\n## Workflow\n\nRun \`/linkedin-engage\` to scrape feed → auto-draft new replies → queue here. Approve/redraft/kill in chat. On \`/linkedin-engage post\` Playwright publishes approved drafts.\n\n\n[[Marketing]]\n`;
  }

  const lines = rows.map(({ row, subject, noteName }) =>
    `| ${row.author} | ${subject.replace(/\|/g, '/')} | ${scannedAt} | [[${noteName}]] |`,
  );

  return `${header}
| Author | Subject | Scanned | Wiki |
| ------ | ------- | ------- | ---- |
${lines.join('\n')}

## Workflow

Run \`/linkedin-engage\` to scrape feed → auto-draft new replies → queue here. Approve/redraft/kill in chat. On \`/linkedin-engage post\` Playwright publishes approved drafts.


[[Marketing]]
`;
}

/** Delete every draft note in the folder, preserving only the index file. */
function wipeDraftNotes(dir: string): number {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    if (name === INDEX_FILE) continue;
    rmSync(join(dir, name), { force: true });
    removed++;
  }
  return removed;
}

/**
 * Mirror the live pending Notion queue into the Obsidian vault Comments folder.
 * Wipes all existing draft notes, writes one fresh note per pending draft, and
 * rebuilds the Comments.md index. No-ops with a warning if the vault is missing.
 */
export async function syncVault(): Promise<{ synced: number; skipped: boolean }> {
  const dir = commentsDir();

  // Guard: only sync if the vault is actually present. We require the grandparent
  // (e.g. .../LinkedIn) to exist so we never scaffold a bogus tree in a stray dir;
  // the Comments leaf itself is created if missing.
  const grandparent = join(dir, '..', '..');
  if (!existsSync(grandparent)) {
    console.log(`Vault: skipped (no vault at ${dir}).`);
    return { synced: 0, skipped: true };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const scannedAt = today();
  const pending = await listPending();

  wipeDraftNotes(dir);

  const indexRows: Array<{ row: QueueRow; subject: string; noteName: string }> = [];
  const usedNames = new Set<string>();

  for (const row of pending) {
    const subject = deriveSubject(row.postText);
    let noteName = sanitizeFilename(`${row.author} — ${subject}`);
    if (!noteName) noteName = sanitizeFilename(row.author) || addressFor(row.pageId);
    let unique = noteName;
    let i = 2;
    while (usedNames.has(unique)) unique = `${noteName} (${i++})`;
    usedNames.add(unique);

    writeFileSync(join(dir, `${unique}.md`), noteBody(row, subject, scannedAt), 'utf8');
    indexRows.push({ row, subject, noteName: unique });
  }

  writeFileSync(join(dir, INDEX_FILE), buildIndex(indexRows, scannedAt), 'utf8');

  console.log(`Vault: ${pending.length} draft${pending.length === 1 ? '' : 's'} synced to ${dir}.`);
  return { synced: pending.length, skipped: false };
}

// Allow standalone invocation: `npm run sync:vault`
const isMain = process.argv[1] && process.argv[1].endsWith('vault/sync.ts');
if (isMain) {
  syncVault().catch((err) => {
    console.error(`Vault sync failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
