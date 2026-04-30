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
    const found: any[] = (await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      function extractData(item) {
        const ctrlMenu = item.querySelector('[aria-label^="Open control menu for post by "]');
        const hideBtn = item.querySelector('[aria-label^="Hide post by "]');
        const aria = (ctrlMenu && ctrlMenu.getAttribute('aria-label')) || (hideBtn && hideBtn.getAttribute('aria-label')) || '';
        let author = '';
        const m = aria.match(/^(?:Open control menu for post by|Hide post by)\\s+(.+?)$/);
        if (m) author = m[1].replace(/^[^\\p{L}\\p{N}]+/u, '').trim();

        const textBox = item.querySelector('[data-testid="expandable-text-box"]');
        const text = textBox ? (textBox.innerText || textBox.textContent || '').trim() : '';

        const ariaText = item.innerText || '';
        const isJobOrPoll = /Promoted|^Promoted|This is a poll|Apply for|jobs/i.test(ariaText.slice(0, 200));

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

        let commentCount = null;
        const cmm = ariaText.match(/(\\d{1,5})\\s+comments?\\b/);
        if (cmm) commentCount = parseInt(cmm[1], 10);

        const um = item.outerHTML.match(/urn:li:activity:(\\d+)/);
        const urn = um ? um[1] : null;

        return { author, text, ageDays, commentCount, isJobOrPoll, urn };
      }

      const out = [];
      const feed = document.querySelector('[data-testid="mainFeed"]');
      if (!feed) return out;

      const items = feed.querySelectorAll('[role="listitem"]');
      for (const item of items) {
        let data = extractData(item);
        if (!data.author) continue;
        if (!data.text || data.text.length < 1) continue;

        // If post would obviously be filtered downstream, don't bother surfacing URN
        if (data.isJobOrPoll) {
          out.push({ ...data, skip: 'filtered-pre-urn' });
          continue;
        }

        // URN absent? Click the post's Comment button to force LinkedIn to fetch
        // the comment thread, which embeds the URN in DOM. Then press Escape.
        // This is required since LinkedIn moved to opaque componentkeys (~2026)
        // and stopped including URNs in feed-render markup.
        if (!data.urn) {
          const buttons = item.querySelectorAll('button');
          let commentBtn = null;
          for (const b of buttons) {
            const lbl = (b.getAttribute('aria-label') || b.textContent || '').trim();
            if (lbl === 'Comment') { commentBtn = b; break; }
          }
          if (commentBtn) {
            try {
              commentBtn.scrollIntoView({ block: 'center' });
              await sleep(200 + Math.random() * 200);
              commentBtn.click();
              // Wait for URN to appear (poll up to 2.5s)
              const deadline = Date.now() + 2500;
              while (Date.now() < deadline) {
                await sleep(150);
                const um = item.outerHTML.match(/urn:li:activity:(\\d+)/);
                if (um) { data.urn = um[1]; break; }
              }
              // Close the editor
              document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              await sleep(150);
            } catch (e) {
              // ignore, fall through to no-urn skip
            }
          }
        }

        if (!data.urn) {
          out.push({ ...data, skip: 'no-urn' });
          continue;
        }

        out.push({ urn: data.urn, author: data.author, text: data.text, ageDays: data.ageDays, commentCount: data.commentCount, isJobOrPoll: data.isJobOrPoll });
      }
      return out;
    })()`)) as any[];

    for (const p of found) {
      if (p.skip === 'no-urn') { postsWithoutUrn++; continue; }
      if (p.skip === 'filtered-pre-urn') continue; // job/poll, not a URN problem
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
