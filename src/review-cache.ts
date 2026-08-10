import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './config.js';

const CACHE_PATH = join(STATE_DIR, 'review-cache.json');

export interface ReviewCache {
  builtAt: string;
  mapping: Record<string, string>;
}

export function writeCache(mapping: Record<string, string>): void {
  const data: ReviewCache = { builtAt: new Date().toISOString(), mapping };
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function readCache(): ReviewCache | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as ReviewCache;
  } catch {
    return null;
  }
}

export function resolveIds(arg: string): string[] {
  const cache = readCache();
  if (!cache) {
    throw new Error('No review cache found. Run `npm run review` first to list drafts.');
  }
  if (arg.trim().toLowerCase() === 'all') {
    return Object.values(cache.mapping);
  }
  const ids = arg.split(',').map(s => s.trim()).filter(Boolean);
  const pageIds: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const pid = cache.mapping[id];
    if (pid) pageIds.push(pid);
    else missing.push(id);
  }
  if (missing.length) {
    throw new Error(`Unknown IDs: ${missing.join(', ')}. Re-run \`npm run review\` to refresh the mapping.`);
  }
  return pageIds;
}
