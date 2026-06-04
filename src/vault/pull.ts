import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { listPending, listApproved, markStatus, QueueStatus } from '../notion/queue.js';
import { commentsDir } from './sync.js';

const INDEX_FILE = 'Comments.md';

// Statuses a human can set in a vault note that we propagate into Notion.
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
 * Read human status decisions from the vault notes and push them into Notion.
 *
 * The vault is the control surface: Dan sets `status: approved` (publish) or
 * `status: skipped` (kill) in a note's frontmatter. This reconciles those edits
 * into the Notion queue that the publisher reads. Joins on `page_id` when present,
 * falling back to `post_url`. Notes already in sync are skipped. No-ops if the
 * vault is missing. Never throws past a single note — a bad note is logged and skipped.
 */
export async function pullVault(): Promise<{ approved: number; skipped: number; unchanged: number }> {
  const dir = commentsDir();
  if (!existsSync(dir)) return { approved: 0, skipped: 0, unchanged: 0 };

  const rows = [...await listPending(), ...await listApproved()];
  const byPageId = new Map(rows.map(r => [r.pageId, r]));
  const byUrl = new Map(rows.map(r => [r.postUrl, r]));

  let approved = 0, skipped = 0, unchanged = 0;

  for (const note of readNotes(dir)) {
    if (!HUMAN_STATUSES.has(note.status as QueueStatus)) continue;
    const row = (note.pageId && byPageId.get(note.pageId)) || (note.postUrl && byUrl.get(note.postUrl));
    if (!row) continue; // already terminal in Notion (published/etc.) or not found
    if (row.status === note.status) { unchanged++; continue; }
    try {
      await markStatus(row.pageId, note.status as QueueStatus);
      if (note.status === 'approved') approved++; else skipped++;
    } catch (err) {
      console.log(`  Vault pull: could not update "${note.file}" — ${(err as Error).message}`);
    }
  }

  if (approved || skipped) {
    console.log(`Vault pull: ${approved} approved, ${skipped} killed synced from vault → queue.`);
  }
  return { approved, skipped, unchanged };
}

// Allow standalone invocation: `npm run pull:vault`
const isMain = process.argv[1] && process.argv[1].endsWith('vault/pull.ts');
if (isMain) {
  pullVault()
    .then(r => console.log(`Done: +${r.approved} approved, +${r.skipped} killed, ${r.unchanged} already in sync.`))
    .catch((err) => {
      console.error(`Vault pull failed: ${(err as Error).message}`);
      process.exit(1);
    });
}
