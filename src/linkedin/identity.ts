import { Page } from 'playwright';
import { sleep, jitter } from './browser.js';

let cached: string | null = null;

export async function detectMyVanity(page: Page): Promise<string | null> {
  if (cached) return cached;
  const envOverride = (process.env.MY_LINKEDIN_VANITY ?? '').trim().toLowerCase();
  if (envOverride) {
    cached = envOverride;
    return cached;
  }
  try {
    await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(jitter(900, 1600));
    const url = page.url();
    const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m) cached = decodeURIComponent(m[1]).toLowerCase();
    return cached;
  } catch {
    return null;
  }
}
