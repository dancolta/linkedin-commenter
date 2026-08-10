import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { listPending, listApproved, markStatus, QueueStatus } from '../queue.js';
import { commentsDir } from './sync.js';
import { readManifest } from './manifest.js';

const INDEX_FILE = 'Comments.md';

// Statuses a human can set in a vault note that we propagate into the local queue.
// `skipped` is how Dan kills a draft from the vault.
const HUMAN_STATUSES = new Set<QueueStatus>(['approved', 'skipped']);

interface NoteState {
  file: string;
  status: string;
  postUrl: string;
  pageId: string;
}

/** Minimal frontmatter reader for the simple `key: value` blocks sync.ts writes. */
export function parseFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function readNotes(dir: string): NoteState[] {
  const out: NoteState[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === INDEX_FILE) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, name), 'utf8'));
    if ((fm.type ?? '') !== 'linkedin-comment') continue;
    out.push({
      file: name,
      status: (fm.status ?? '').toLowerCase(),
      postUrl: fm.post_url ?? '',
      pageId: fm.page_id ?? '',
    });
  }
  return out;
}

/**
 * Kill any draft whose note Dan deleted from the vault folder by hand.
 *
 * Deleting the note IS the veto — that's the whole point of drafts landing
 * pre-approved. We can only read absence as intent because the manifest records
 * what the last sync actually wrote; a note in the manifest, still active in the
 * queue, and no longer on disk was removed by a human.
 *
 * Two guards keep an unavailable vault from being mistaken for a mass veto:
 * the folder must exist, and it must still contain at least one .md file (the
 * index alone is enough). An empty or half-synced folder aborts the check
 * rather than nuking the queue.
 */
async function killDeletedNotes(dir: string): Promise<number> {
  const manifest = readManifest();
  if (!manifest || Object.keys(manifest.notes).length === 0) return 0;

  const present = readdirSync(dir).filter(n => n.endsWith('.md'));
  if (present.length === 0) {
    console.log('  Vault pull: Comments folder looks empty/unsynced — skipping delete detection.');
    return 0;
  }
  const onDisk = new Set(present);

  const active = new Map(
    [...await listPending(), ...await listApproved()].map(r => [r.pageId, r]),
  );

  let killed = 0;
  for (const [pageId, filename] of Object.entries(manifest.notes)) {
    if (onDisk.has(filename)) continue;
    const row = active.get(pageId);
    if (!row) continue; // already published/killed — nothing to do
    try {
      await markStatus(pageId, 'skipped', { reason: 'note deleted from vault by hand' });
      console.log(`  ✗ Killed (deleted from vault): ${row.author}`);
      killed++;
    } catch (err) {
      console.log(`  Vault pull: could not kill "${filename}" — ${(err as Error).message}`);
    }
  }
  return killed;
}

/**
 * Read human decisions from the vault and push them into the local queue.
 *
 * Two channels, both meaning "don't publish this": a `status: skipped` edit in a
 * note's frontmatter, or deleting the note outright. `status: approved` is still
 * honoured for anything sitting pending (e.g. AUTO_APPROVE turned off). Joins on
 * `page_id` when present, falling back to `post_url`. No-ops if the vault is
 * missing. Never throws past a single note — a bad note is logged and skipped.
 */
export async function pullVault(): Promise<{ approved: number; skipped: number; deleted: number; unchanged: number }> {
  const dir = commentsDir();
  if (!existsSync(dir)) return { approved: 0, skipped: 0, deleted: 0, unchanged: 0 };

  // Deletions first: a note that's gone can't be read for a status edit below.
  const deleted = await killDeletedNotes(dir);

  const rows = [...await listPending(), ...await listApproved()];
  const byPageId = new Map(rows.map(r => [r.pageId, r]));
  const byUrl = new Map(rows.map(r => [r.postUrl, r]));

  let approved = 0, skipped = 0, unchanged = 0;

  for (const note of readNotes(dir)) {
    if (!HUMAN_STATUSES.has(note.status as QueueStatus)) continue;
    const row = (note.pageId && byPageId.get(note.pageId)) || (note.postUrl && byUrl.get(note.postUrl));
    if (!row) continue; // already terminal in the queue (published/etc.) or not found
    if (row.status === note.status) { unchanged++; continue; }
    try {
      await markStatus(row.pageId, note.status as QueueStatus);
      if (note.status === 'approved') approved++; else skipped++;
    } catch (err) {
      console.log(`  Vault pull: could not update "${note.file}" — ${(err as Error).message}`);
    }
  }

  if (approved || skipped || deleted) {
    const parts = [`${approved} approved`, `${skipped} killed`];
    if (deleted) parts.push(`${deleted} deleted-from-vault`);
    console.log(`Vault pull: ${parts.join(', ')} synced from vault → queue.`);
  }
  return { approved, skipped, deleted, unchanged };
}

// Allow standalone invocation: `npm run pull:vault`
const isMain = process.argv[1] && process.argv[1].endsWith('vault/pull.ts');
if (isMain) {
  pullVault()
    .then(r => console.log(`Done: +${r.approved} approved, +${r.skipped} killed, +${r.deleted} deleted-from-vault, ${r.unchanged} already in sync.`))
    .catch((err) => {
      console.error(`Vault pull failed: ${(err as Error).message}`);
      process.exit(1);
    });
}
