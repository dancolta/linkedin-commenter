import Database from 'better-sqlite3';
import { SQLITE_PATH, madridMidnightISO } from '../config.js';

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS seen_posts (
    post_url TEXT PRIMARY KEY,
    author TEXT,
    seen_at TEXT
  );
  CREATE TABLE IF NOT EXISTS author_history (
    author TEXT,
    commented_at TEXT,
    PRIMARY KEY (author, commented_at)
  );
  CREATE TABLE IF NOT EXISTS recent_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    posted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS daily_counter (
    madrid_date TEXT PRIMARY KEY,
    published INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS publish_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    failed_at TEXT,
    reason TEXT
  );
`);

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getFirstRunAt(): Date {
  const v = getMeta('first_run_at');
  if (v) return new Date(v);
  const now = new Date();
  setMeta('first_run_at', now.toISOString());
  return now;
}

export function markPostSeen(postUrl: string, author: string): void {
  db.prepare('INSERT OR IGNORE INTO seen_posts (post_url, author, seen_at) VALUES (?, ?, ?)').run(postUrl, author, new Date().toISOString());
}

export function isPostSeen(postUrl: string): boolean {
  return db.prepare('SELECT 1 FROM seen_posts WHERE post_url = ?').get(postUrl) !== undefined;
}

export function recordAuthorComment(author: string): void {
  db.prepare('INSERT OR IGNORE INTO author_history (author, commented_at) VALUES (?, ?)').run(author, new Date().toISOString());
}

export function commentedAuthorRecently(author: string, daysWindow = 14): boolean {
  const cutoff = new Date(Date.now() - daysWindow * 86_400_000).toISOString();
  return db.prepare('SELECT 1 FROM author_history WHERE author = ? AND commented_at > ?').get(author, cutoff) !== undefined;
}

export function recordPublishedComment(text: string): void {
  db.prepare('INSERT INTO recent_comments (text, posted_at) VALUES (?, ?)').run(text, new Date().toISOString());
}

export function getRecentComments(limit = 20): string[] {
  return (db.prepare('SELECT text FROM recent_comments ORDER BY id DESC LIMIT ?').all(limit) as { text: string }[]).map(r => r.text);
}

export function incrementDailyPublished(): number {
  const date = madridMidnightISO();
  db.prepare('INSERT INTO daily_counter (madrid_date, published) VALUES (?, 1) ON CONFLICT(madrid_date) DO UPDATE SET published = published + 1').run(date);
  return getDailyPublished();
}

export function getDailyPublished(): number {
  const date = madridMidnightISO();
  const row = db.prepare('SELECT published FROM daily_counter WHERE madrid_date = ?').get(date) as { published: number } | undefined;
  return row?.published ?? 0;
}

export function recordFailure(reason: string): number {
  db.prepare('INSERT INTO publish_failures (failed_at, reason) VALUES (?, ?)').run(new Date().toISOString(), reason);
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const row = db.prepare('SELECT COUNT(*) AS c FROM publish_failures WHERE failed_at > ?').get(cutoff) as { c: number };
  return row.c;
}

export function clearRecentFailures(): void {
  db.prepare('DELETE FROM publish_failures').run();
}
