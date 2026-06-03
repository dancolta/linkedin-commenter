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
  const maxScrolls = 20;
  const perCallItemBudget = 6; // cap URN-extraction work per scroll, prevents page meltdown

  while (posts.length < max && scrolls < maxScrolls) {
    const probe: any = (await page.evaluate(`(async (budget) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      function extractData(item) {
        // Locale-agnostic author extraction via aria-label pattern matching.
        // Matches phrases like:
        //   EN: "Open control menu for post by NAME" / "Hide post by NAME"
        //   ES: "Abrir el menú de controles para la publicación de NAME" / "Ocultar la publicación de NAME"
        //   FR: "Ouvrir le menu de contrôle de la publication de NAME"
        // Strategy: find any aria-label containing "post by " | "publicación de " | "publication de "
        // and extract everything after that marker.
        let author = '';
        const markers = [
          { re: /\\bpost by\\s+(.+)$/i, group: 1 },
          { re: /\\bpublicación de\\s+(.+)$/i, group: 1 },
          { re: /\\bpublicaci[oó]n de\\s+(.+)$/i, group: 1 },
          { re: /\\bpublication de\\s+(.+)$/i, group: 1 },
          { re: /\\bBeitrag von\\s+(.+)$/i, group: 1 },
          { re: /\\bpost di\\s+(.+)$/i, group: 1 },
        ];
        const ariaEls = item.querySelectorAll('[aria-label]');
        outer: for (const el of ariaEls) {
          const lbl = el.getAttribute('aria-label') || '';
          for (const m of markers) {
            const mm = lbl.match(m.re);
            if (mm) {
              author = mm[m.group].trim();
              // Strip trailing role markers like " profile" if any
              break outer;
            }
          }
        }
        // Fallback: derive from innerText head — first non-empty line after "Publicación en el feed" / "Feed post"
        if (!author) {
          const head = (item.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
          // skip generic role labels
          const skipRx = /^(Publicación en el feed|Feed post|Promocionado|Promoted|Sponsored|Patrocinado)$/i;
          for (const line of head) {
            if (skipRx.test(line)) continue;
            if (line.length > 1 && line.length < 80 && !/^\\d/.test(line)) { author = line; break; }
          }
        }
        author = author.replace(/^[^\\p{L}\\p{N}]+/u, '').trim();

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
      let urnAttempts = 0;
      for (const item of items) {
        if (item.getAttribute('data-li-processed') === '1') continue;
        let data = extractData(item);
        if (!data.author) continue;
        if (!data.text || data.text.length < 1) continue;
        item.setAttribute('data-li-processed', '1');

        // If post would obviously be filtered downstream, don't bother surfacing URN
        if (data.isJobOrPoll) {
          out.push({ ...data, skip: 'filtered-pre-urn' });
          continue;
        }

        // URN absent? Click the post's Comment button to force LinkedIn to fetch
        // the comment thread, which embeds the URN in DOM. Then press Escape.
        // This is required since LinkedIn moved to opaque componentkeys (~2026)
        // and stopped including URNs in feed-render markup.
        if (!data.urn && urnAttempts < budget) {
          urnAttempts++;
          const buttons = item.querySelectorAll('button');
          let commentBtn = null;
          const commentLabels = ['Comment', 'Comentar', 'Commenter', 'Kommentieren', 'Commenta'];
          for (const b of buttons) {
            const lbl = (b.getAttribute('aria-label') || b.textContent || '').trim();
            if (commentLabels.includes(lbl)) { commentBtn = b; break; }
          }
          if (commentBtn) {
            try {
              commentBtn.scrollIntoView({ block: 'center' });
              await sleep(200 + Math.random() * 200);
              commentBtn.click();
              // Wait for URN to appear (poll up to 1.2s)
              const deadline = Date.now() + 1200;
              while (Date.now() < deadline) {
                await sleep(120);
                const um = item.outerHTML.match(/urn:li:activity:(\\d+)/);
                if (um) { data.urn = um[1]; break; }
              }
              // Close the editor — try focused element + body
              const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
              (document.activeElement || document.body).dispatchEvent(ev);
              document.body.dispatchEvent(ev);
              await sleep(120);
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
      return { out };
    })(${perCallItemBudget})`)) as any;
    const found: any[] = probe.out || [];

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
      if (scrolls % 3 === 0) {
        console.log(`  ...scroll ${scrolls}/${maxScrolls}, posts=${posts.length}/${max}, no-urn=${postsWithoutUrn}`);
      }
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
