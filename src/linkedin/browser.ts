import { chromium, BrowserContext, Page } from 'playwright';
import { CHROME_PROFILE_DIR } from '../config.js';
import { existsSync, mkdirSync } from 'node:fs';

export async function launch(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  if (!existsSync(CHROME_PROFILE_DIR)) mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  // Default to headless. Override per-call (e.g. setup.ts needs headed for login).
  // LINKEDIN_HEADED=1 in .env forces headed for ad-hoc debugging.
  const headless = opts.headless ?? (process.env.LINKEDIN_HEADED === '1' ? false : true);
  return chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
    headless,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const jitter = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

export async function humanScroll(page: Page, steps = 8): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const dy = jitter(200, 600);
    await page.mouse.wheel(0, dy);
    await sleep(jitter(1500, 4000));
    if (Math.random() < 0.15) {
      await page.mouse.wheel(0, -jitter(50, 200));
      await sleep(jitter(800, 1500));
    }
  }
}

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await sleep(jitter(300, 700));
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(jitter(40, 120));
    if (Math.random() < 0.05) await sleep(jitter(300, 800));
  }
}
