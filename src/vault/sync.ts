import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { listPending, listApproved, QueueRow } from '../queue.js';
import { pullVault, parseFrontmatter } from './pull.js';
import { readManifest, writeManifest } from './manifest.js';

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

/** Deterministic 6-digit address slug from the draft id. */
function addressFor(pageId: string): string {
  const hex = createHash('sha1').update(pageId).digest('hex').slice(0, 6);
  const n = parseInt(hex, 16) % 1_000_000;
  return `c-${String(n).padStart(6, '0')}`;
}

function noteBody(row: QueueRow, subject: string, scannedAt: string): string {
  const fmTitle = `${row.author} — ${subject}`.replace(/"/g, "'");
  const status = row.status === 'approved' ? 'approved' : 'pending';
  return `---
type: linkedin-comment
title: "${fmTitle}"
status: ${status}
scanned_at: ${scannedAt}
address: ${addressFor(row.pageId)}
page_id: ${row.pageId}
author: ${row.author}
post_url: "${row.postUrl}"
tags: [linkedin, comment, channel/linkedin, ${status}, draft]
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

interface IndexRow { author: string; subject: string; status: string; noteName: string; }

function buildIndex(rows: IndexRow[], scannedAt: string): string {
  const header = `---
type: index
title: "LinkedIn Comments"
status: living-doc
created: 2026-06-03
updated: ${scannedAt}
tags: [linkedin, comments, index, channel/linkedin]
---

# LinkedIn Comments Queue

**This folder is the veto surface.** Drafts land here already \`status: approved\` — say "post it" and every note below goes out. You only need to touch a note to *stop* it:

- **delete the note** → killed, won't publish (simplest veto)
- \`status: skipped\` → same thing, if you'd rather keep the note around
- leave it alone → publishes on the next \`/linkedin-engage post\`

Both vetoes are read back into the queue before anything publishes, so a note you removed can't come back on a later sync. \`/linkedin-engage post\` publishes the survivors via Playwright, then clears them out. Status flow: \`approved\` → \`published\` (or \`skipped\`).

## Drafts
`;

  if (rows.length === 0) {
    return `${header}\n_No active drafts. Run \`/linkedin-engage\` to scan and queue._\n\n\n[[Marketing]]\n`;
  }

  const lines = rows.map(({ author, subject, status, noteName }) =>
    `| ${author} | ${subject.replace(/\|/g, '/')} | ${status === 'approved' ? '✅ approved' : 'pending'} | [[${noteName}]] |`,
  );

  return `${header}
| Author | Subject | Status | Wiki |
| ------ | ------- | ------ | ---- |
${lines.join('\n')}

## How to use

1. Run \`/linkedin-engage\` to scan + queue new drafts here (already approved).
2. Skim. Delete any note you don't want out (or set \`status: skipped\`).
3. Run \`/linkedin-engage post\` — everything still here publishes, then leaves the folder.


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
 * Mirror the live active queue (pending + approved) into the Obsidian vault.
 *
 * First pulls any human decisions Dan made in the vault (status edits) back into
 * the queue so they aren't lost, then wipes and rebuilds the folder from the resulting
 * active set. Approved notes therefore survive a rebuild and stay marked approved;
 * killed (skipped) and published notes drop out. No-ops if the vault is missing.
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

  // Capture Dan's vault-side status edits into the queue before we wipe the folder.
  await pullVault();

  const scannedAt = today();
  // Active set = still-actionable drafts. Approved come first so they sort to the top.
  const active = [...await listApproved(), ...await listPending()];

  wipeDraftNotes(dir);

  const indexRows: IndexRow[] = [];
  const usedNames = new Set<string>();
  // pageId → filename, so the next pull can tell "Dan deleted this note" apart
  // from "this note was never written".
  const manifest: Record<string, string> = {};

  for (const row of active) {
    const subject = deriveSubject(row.postText);
    let noteName = sanitizeFilename(`${row.author} — ${subject}`);
    if (!noteName) noteName = sanitizeFilename(row.author) || addressFor(row.pageId);
    let unique = noteName;
    let i = 2;
    while (usedNames.has(unique)) unique = `${noteName} (${i++})`;
    usedNames.add(unique);

    writeFileSync(join(dir, `${unique}.md`), noteBody(row, subject, scannedAt), 'utf8');
    indexRows.push({ author: row.author, subject, status: row.status, noteName: unique });
    manifest[row.pageId] = `${unique}.md`;
  }

  writeFileSync(join(dir, INDEX_FILE), buildIndex(indexRows, scannedAt), 'utf8');
  writeManifest(manifest);

  const approvedCount = active.filter(r => r.status === 'approved').length;
  console.log(`Vault: ${active.length} draft${active.length === 1 ? '' : 's'} synced (${approvedCount} approved) to ${dir}.`);
  return { synced: active.length, skipped: false };
}

/** Rebuild Comments.md purely from the notes currently on disk (no queue call). */
export function rebuildIndexFromDisk(dir: string): void {
  const rows: IndexRow[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === INDEX_FILE) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, name), 'utf8'));
    if ((fm.type ?? '') !== 'linkedin-comment') continue;
    const title = fm.title ?? name.replace(/\.md$/, '');
    const subject = title.includes(' — ') ? title.split(' — ').slice(1).join(' — ') : title;
    rows.push({
      author: fm.author ?? '',
      subject,
      status: (fm.status ?? 'pending').toLowerCase(),
      noteName: name.replace(/\.md$/, ''),
    });
  }
  rows.sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
  writeFileSync(join(dir, INDEX_FILE), buildIndex(rows, today()), 'utf8');
}

/**
 * Live update: a draft just got published — remove its note from the vault folder
 * and rebuild the index immediately so Obsidian reflects it in real time. Matches
 * on page_id (falls back to post_url). Safe no-op if the vault/note is missing.
 */
export function removePublishedNote(opts: { pageId?: string; postUrl?: string }): boolean {
  const dir = commentsDir();
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === INDEX_FILE) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, name), 'utf8'));
    const match = (opts.pageId && fm.page_id === opts.pageId) || (opts.postUrl && fm.post_url === opts.postUrl);
    if (!match) continue;
    rmSync(join(dir, name), { force: true });
    // Drop it from the manifest too — we deleted this note, Dan didn't, and the
    // next pull must not read our own cleanup as a human veto.
    const m = readManifest();
    if (m) {
      const pruned = Object.fromEntries(Object.entries(m.notes).filter(([, f]) => f !== name));
      writeManifest(pruned);
    }
    rebuildIndexFromDisk(dir);
    return true;
  }
  return false;
}

// Allow standalone invocation: `npm run sync:vault`
const isMain = process.argv[1] && process.argv[1].endsWith('vault/sync.ts');
if (isMain) {
  syncVault().catch((err) => {
    console.error(`Vault sync failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
