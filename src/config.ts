import 'dotenv/config';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export const STATE_DIR = join(homedir(), '.linkedin-engage');
export const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || join(STATE_DIR, 'chrome-profile');
export const SQLITE_PATH = join(STATE_DIR, 'state.db');
export const PAUSED_FLAG = join(STATE_DIR, 'PAUSED');

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

export const DRY_RUN = process.env.DRY_RUN === '1';
export const PAUSED_ENV = process.env.LINKEDIN_PAUSE === '1';

export const ONLY_AUTHORS = parseList('ONLY_AUTHORS');
export const SKIP_AUTHORS = parseList('SKIP_AUTHORS');
export const ONLY_KEYWORDS = parseList('ONLY_KEYWORDS');
export const SKIP_KEYWORDS = parseList('SKIP_KEYWORDS');

// Daily cap removed per Dan's request 2026-05-28. Pacing (gap) and scan size still enforced.
// Per-run override via PUBLISH_LIMIT env var (used in publish.ts).
export const PHASES = [
  { days: 3, dailyCap: Infinity, minGapMs: 45_000, maxGapMs: 120_000, maxScan: 20 },
  { days: 7, dailyCap: Infinity, minGapMs: 30_000, maxGapMs: 90_000, maxScan: 25 },
  { days: Infinity, dailyCap: Infinity, minGapMs: 30_000, maxGapMs: 90_000, maxScan: 30 },
];

export function currentPhase(firstRunAt: Date): typeof PHASES[number] {
  const days = Math.floor((Date.now() - firstRunAt.getTime()) / 86_400_000);
  let cumulative = 0;
  for (const phase of PHASES) {
    cumulative += phase.days;
    if (days < cumulative) return phase;
  }
  return PHASES[PHASES.length - 1];
}

export function madridMidnightISO(): string {
  const now = new Date();
  const madrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return madrid;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseList(name: string): string[] {
  return (process.env[name] ?? '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
}
