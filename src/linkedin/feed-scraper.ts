import { Page } from 'playwright';
import { humanScroll, sleep, jitter } from './browser.js';
import { snapshotIncident } from './safety-check.js';

export interface ScrapedPost {
  postUrl: string;
  author: string;
  text: string;
  ageDays: number | null;
  commentCount: number | null;
  isJobOrPoll: boolean;
}

export async function scrapeFeed(page: Page, max: number): Promise<ScrapedPost[]> {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  try {
    await page.waitForSelector('[data-testid="mainFeed"]', { timeout: 20_000 });
  } catch {
    await snapshotIncident(page, 'no-mainFeed');
    return [];
  }
  await sleep(jitter(3000, 5000));

  const posts: ScrapedPost[] = [];
  const seenUrns = new Set<string>();
  let scrolls = 0;
  let postsWithoutUrn = 0;
  const maxScrolls = 60;

  while (posts.length < max && scrolls < maxScrolls) {
    const found: any[] = (await page.evaluate(`(() => {
      function decodeUrnFromPrefix(b64) {
        try {
          const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
          const padded = norm + '='.repeat((4 - norm.length % 4) % 4);
          const bin = atob(padded);
          if (bin.charCodeAt(0) !== 0x0a || bin.charCodeAt(2) !== 0x08) return null;
          let val = 0n, shift = 0n;
          for (let i = 3; i < bin.length; i++) {
            const byte = bin.charCodeAt(i);
            val |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) return (val >> 1n).toString();
            shift += 7n;
          }
          return null;
        } catch (e) { return null; }
      }

      const out = [];
      const feed = document.querySelector('[data-testid="mainFeed"]');
      if (!feed) return out;

      const items = feed.querySelectorAll('[role="listitem"]');
      items.forEach(item => {
        // Author from aria-label
        const ctrlMenu = item.querySelector('[aria-label^="Open control menu for post by "]');
        const hideBtn = item.querySelector('[aria-label^="Hide post by "]');
        const aria = (ctrlMenu && ctrlMenu.getAttribute('aria-label')) || (hideBtn && hideBtn.getAttribute('aria-label')) || '';
        let author = '';
        let m = aria.match(/^(?:Open control menu for post by|Hide post by)\\s+(.+?)$/);
        if (m) author = m[1].replace(/^[^\\p{L}\\p{N}]+/u, '').trim();
        if (!author) return;

        // URN: try (a) decode from replaceableCommentTools prefix, (b) explicit comment URN
        let urn = null;
        const componentEls = item.querySelectorAll('[componentkey]');
        for (const el of componentEls) {
          const ck = el.getAttribute('componentkey') || '';
          // Method A: protobuf-encoded prefix on replaceableCommentTools
          const pbm = ck.match(/^([A-Za-z0-9+/_=-]+)-replaceableCommentTools/);
          if (pbm) {
            const decoded = decodeUrnFromPrefix(pbm[1]);
            if (decoded) { urn = decoded; break; }
          }
          // Method B: explicit URN in comment componentkey
          const um = ck.match(/urn:li:activity:(\\d+)/);
          if (um) { urn = um[1]; break; }
        }
        if (!urn) { out.push({ skip: 'no-urn', author }); return; }

        // Post text
        const textBox = item.querySelector('[data-testid="expandable-text-box"]');
        const text = textBox ? (textBox.innerText || textBox.textContent || '').trim() : '';
        if (!text || text.length < 1) return;

        // Job / poll / repost-without-commentary heuristics
        const ariaText = item.innerText || '';
        const isJobOrPoll = /Promoted|^Promoted|This is a poll|Apply for|jobs/i.test(ariaText.slice(0, 200));

        // Age — find first text that looks like "5h", "2d", "3w", "1mo"
        const ageMatch = ariaText.match(/(\\d+)\\s*(m|h|d|w|mo|y)\\b/);
        let ageDays = null;
        if (ageMatch) {
          const n = parseInt(ageMatch[1], 10);
          const u = ageMatch[2];
          if (u === 'm') ageDays = n / 1440;
          else if (u === 'h') ageDays = n / 24;
          else if (u === 'd') ageDays = n;
          else if (u === 'w') ageDays = n * 7;
          else if (u === 'mo') ageDays = n * 30;
          else if (u === 'y') ageDays = n * 365;
        }

        // Comment count — look for "X comments" or "X comment"
        let commentCount = null;
        const cmm = ariaText.match(/(\\d{1,5})\\s+comments?\\b/);
        if (cmm) commentCount = parseInt(cmm[1], 10);

        out.push({ urn, author, text, ageDays, commentCount, isJobOrPoll });
      });
      return out;
    })()`)) as any[];

    for (const p of found) {
      if (p.skip === 'no-urn') { postsWithoutUrn++; continue; }
      if (seenUrns.has(p.urn)) continue;
      seenUrns.add(p.urn);
      posts.push({
        postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${p.urn}/`,
        author: p.author,
        text: p.text,
        ageDays: p.ageDays,
        commentCount: p.commentCount,
        isJobOrPoll: p.isJobOrPoll,
      });
      if (posts.length >= max) break;
    }

    if (posts.length < max) {
      await humanScroll(page, 2);
      scrolls++;
    }
  }

  if (posts.length === 0) {
    await snapshotIncident(page, 'empty-feed');
  }
  if (postsWithoutUrn > 0) {
    console.log(`  (${postsWithoutUrn} posts skipped — no URN extractable, post had no rendered comments)`);
  }

  return posts;
}
