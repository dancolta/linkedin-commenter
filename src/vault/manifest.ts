import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STATE_DIR } from '../config.js';

/**
 * Record of what `syncVault` last wrote into the Obsidian Comments folder.
 *
 * This exists so "note is missing" can be read as a decision instead of noise.
 * The vault folder is wiped and rebuilt on every sync, so absence on its own
 * means nothing — but absence of a note we *know* we wrote, and that is still
 * active in the queue, means Dan deleted it by hand. That's a kill.
 *
 * Lives in ~/.linkedin-engage (never in the vault) so Obsidian never shows it
 * and the folder wipe can't destroy the very thing tracking the folder.
 */
const MANIFEST_PATH = join(STATE_DIR, 'vault-manifest.json');

export interface VaultManifest {
  writtenAt: string;
  /** pageId → note filename (with .md) as written into the Comments folder. */
  notes: Record<string, string>;
}

export function writeManifest(notes: Record<string, string>): void {
  const data: VaultManifest = { writtenAt: new Date().toISOString(), notes };
  writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function readManifest(): VaultManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as VaultManifest;
    return parsed && typeof parsed.notes === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
