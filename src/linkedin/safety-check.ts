import { Page } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PAUSED_FLAG } from '../config.js';

const RESTRICTION_SIGNALS = [
  'your account has been restricted',
  'unusual activity',
  'verify your identity',
  'temporary limit',
  'we restricted your account',
  'suspicious activity',
  'please complete this security check',
];

export class AccountPausedError extends Error {
  constructor(public signal: string) {
    super(`LinkedIn account safety signal detected: "${signal}"`);
  }
}

export async function checkAccountHealth(page: Page): Promise<void> {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const bodyText = (await page.textContent('body'))?.toLowerCase() ?? '';
  for (const signal of RESTRICTION_SIGNALS) {
    if (bodyText.includes(signal)) {
      writePauseFlag(`detected: ${signal}`);
      await snapshotIncident(page, signal);
      throw new AccountPausedError(signal);
    }
  }
  if (page.url().includes('/checkpoint/') || page.url().includes('/uas/login')) {
    writePauseFlag(`redirected to checkpoint/login: ${page.url()}`);
    await snapshotIncident(page, 'checkpoint-redirect');
    throw new AccountPausedError('checkpoint or login redirect');
  }
}

export async function snapshotIncident(page: Page, label: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(homedir(), 'Downloads', `linkedin-incident-${label}-${ts}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

export function writePauseFlag(reason: string): void {
  writeFileSync(PAUSED_FLAG, `${new Date().toISOString()}\n${reason}\n`);
}

export function isPaused(): boolean {
  return existsSync(PAUSED_FLAG);
}
