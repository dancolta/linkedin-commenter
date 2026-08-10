// SQLite-backed draft queue. Replaces the former Notion-backed queue while
// keeping the exact same exported API, so every caller (scan, publish, vault
// sync/pull, approve/kill/redraft, status) works unchanged. State lives in the
// local `drafts` table in ~/.linkedin-engage/state.db — no external service.
//
// The vault (Obsidian) remains the control surface; this is the backend the
// vault mirrors and the publisher reads.

import { randomUUID } from 'node:crypto';
import { db } from './cache/sqlite.js';
import { AUTO_APPROVE } from './config.js';

export type QueueStatus = 'pending' | 'approved' | 'publishing' | 'published' | 'failed' | 'skipped' | 'deferred';

export interface QueueRow {
  pageId: string;      // local draft id (kept named pageId so callers/vault joins are unchanged)
  postUrl: string;
  author: string;
  postText: string;
  draft: string;
  finalText: string | null;
  status: QueueStatus;
}

interface DraftRecord {
  id: string;
  post_url: string | null;
  author: string | null;
  post_text: string | null;
  draft: string | null;
  final_text: string | null;
  status: string;
  reason: string | null;
  scanned_at: string | null;
  published_at: string | null;
  created_at: string;
  archived: number;
}

function toRow(r: DraftRecord): QueueRow {
  return {
    pageId: r.id,
    postUrl: r.post_url ?? '',
    author: r.author ?? '',
    postText: r.post_text ?? '',
    draft: r.draft ?? '',
    finalText: (r.final_text && r.final_text.trim()) ? r.final_text : null,
    status: (r.status ?? 'pending') as QueueStatus,
  };
}

/**
 * Queue a freshly drafted comment.
 *
 * Named createPending for API compatibility, but under the default
 * AUTO_APPROVE=on it lands the draft as `approved` — Dan's flow is "scan, glance,
 * say post it", not "tick 10 checkboxes first". Killing is the explicit act now:
 * delete the vault note, set `status: skipped`, or run `npm run kill`.
 */
export async function createPending(input: {
  author: string;
  postUrl: string;
  postText: string;
  draft: string;
  screenshotUrl?: string;   // accepted for API compatibility; not persisted
}): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status: QueueStatus = AUTO_APPROVE ? 'approved' : 'pending';
  db.prepare(
    `INSERT INTO drafts (id, post_url, author, post_text, draft, status, scanned_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.postUrl, input.author, input.postText.slice(0, 4000), input.draft, status, now, now);
  return id;
}

export async function listApproved(): Promise<QueueRow[]> {
  const rows = db.prepare(
    `SELECT * FROM drafts WHERE status = 'approved' AND archived = 0 ORDER BY scanned_at ASC`,
  ).all() as DraftRecord[];
  return rows.map(toRow);
}

export async function listPending(): Promise<QueueRow[]> {
  const rows = db.prepare(
    `SELECT * FROM drafts WHERE status = 'pending' AND archived = 0 ORDER BY scanned_at ASC`,
  ).all() as DraftRecord[];
  return rows.map(toRow);
}

export async function getPostText(pageId: string): Promise<{ author: string; postText: string; oldDraft: string }> {
  const r = db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(pageId) as DraftRecord | undefined;
  return {
    author: r?.author ?? '',
    postText: r?.post_text ?? '',
    oldDraft: r?.draft ?? '',
  };
}

export async function setDraft(pageId: string, draft: string): Promise<void> {
  db.prepare(`UPDATE drafts SET draft = ? WHERE id = ?`).run(draft.slice(0, 4000), pageId);
}

/**
 * Authors that should NOT be re-queued. Active states (pending/approved/publishing)
 * always block; terminal states (published/failed/skipped/deferred) block only if
 * the row was created within the last 14 days. Mirrors the prior queue semantics.
 */
export async function listOpenAuthors(): Promise<Set<string>> {
  const out = new Set<string>();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT DISTINCT author, status, created_at FROM drafts
     WHERE author IS NOT NULL AND author <> ''
       AND (
         status IN ('pending', 'approved', 'publishing')
         OR (status IN ('published', 'failed', 'skipped', 'deferred') AND created_at >= ?)
       )`,
  ).all(fourteenDaysAgo) as { author: string }[];
  for (const r of rows) out.add(r.author.toLowerCase());
  return out;
}

export async function markStatus(
  pageId: string,
  status: QueueStatus,
  extras?: { reason?: string; publishedAt?: Date },
): Promise<void> {
  const sets: string[] = ['status = ?'];
  const vals: any[] = [status];
  if (extras?.reason) { sets.push('reason = ?'); vals.push(extras.reason.slice(0, 500)); }
  if (extras?.publishedAt) { sets.push('published_at = ?'); vals.push(extras.publishedAt.toISOString()); }
  vals.push(pageId);
  db.prepare(`UPDATE drafts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/** Remove a draft from active views. Kept named archivePage for API compatibility. */
export async function archivePage(pageId: string): Promise<void> {
  db.prepare(`UPDATE drafts SET archived = 1 WHERE id = ?`).run(pageId);
}

export async function countByStatus(): Promise<Record<string, number>> {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS c FROM drafts WHERE archived = 0 GROUP BY status`,
  ).all() as { status: string; c: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.c;
  return counts;
}

/** Archive every non-archived draft. Backs `clear-all` — the daily clean-slate reset. */
export async function clearAll(): Promise<number> {
  const res = db.prepare(`UPDATE drafts SET archived = 1 WHERE archived = 0`).run();
  return res.changes;
}
