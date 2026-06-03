import { Page } from 'playwright';
import { sleep, jitter, humanScroll } from './browser.js';
import { snapshotIncident } from './safety-check.js';
import { ScrapedPost } from './feed-scraper.js';

/**
 * Scrape the most-recent post(s) from a specific author's profile.
 *
 * Why this exists: the personalized feed rarely surfaces all priority creators in a
 * single scan. To actively engage with ICP authors we visit each one's
 * `/in/<slug>/recent-activity/all/` page and pick up posts ≤ maxAgeDays old.
 *
 * Safety: this looks like scraping behavior if abused, so the orchestrator (scan.ts)
 * caps profile visits per scan and paces 45–120s between them. This function only
 * does what's needed on a single profile and bails on safety signals.
 *
 * @param page          Playwright page (re-used from the feed-scrape session)
 * @param slug          LinkedIn vanity slug (the part after `/in/`)
 * @param opts.maxPosts How many recent posts to return (default 1 — just the latest)
 * @param opts.maxAgeDays Skip posts older than this many days (default 1)
 * @returns ScrapedPost[] — same shape feed-scraper.ts emits
 */
export async function scrapeAuthorProfile(
  page: Page,
  slug: string,
  opts: { maxPosts?: number; maxAgeDays?: number } = {},
): Promise<ScrapedPost[]> {
  const maxPosts = opts.maxPosts ?? 1;
  const maxAgeDays = opts.maxAgeDays ?? 1;

  const url = `https://www.linkedin.com/in/${slug}/recent-activity/all/`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    console.log(`  profile-scraper @${slug}: navigation failed (${(err as Error).message.slice(0, 80)})`);
    return [];
  }

  // Detect 404 / wrong-slug / profile-not-found early.
  // LinkedIn renders a "This page doesn't exist" or similar text rather than HTTP 404.
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => '');
  if (/page doesn't exist|isn't available|page not found/i.test(bodyText)) {
    console.log(`  profile-scraper @${slug}: profile not found (check slug)`);
    return [];
  }
  // Login-wall / restriction signals → bubble up so scan.ts treats it as a safety event.
  if (/sign in to see|join now to see|you must sign in/i.test(bodyText)) {
    await snapshotIncident(page, `profile-loginwall-${slug}`);
    console.log(`  profile-scraper @${slug}: login-wall hit, aborting profile-walk leg`);
    throw new Error('LOGIN_REQUIRED on profile-walk');
  }

  // Initial settle — recent-activity is a JS-rendered feed-like list.
  await sleep(jitter(2500, 4500));

  // One gentle scroll to make sure the first ~5 posts are in the DOM.
  await humanScroll(page, 2);

  const posts: ScrapedPost[] = await page.evaluate(`(async (maxPosts, maxAgeDays) => {
    function parseAge(text) {
      const m = text.match(/(\\d+)\\s*(m|h|d|w|mo|y)\\b/);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const u = m[2];
      if (u === 'm') return 0;        // minutes — same-day
      if (u === 'h') return 0;        // hours — same-day
      if (u === 'd') return n;
      if (u === 'w') return n * 7;
      if (u === 'mo') return n * 30;
      if (u === 'y') return n * 365;
      return null;
    }

    function extractUrn(item) {
      // LinkedIn post cards expose the URN via data-urn or in a nested element.
      const direct = item.getAttribute('data-urn');
      if (direct && direct.startsWith('urn:li:activity:')) return direct;
      const nested = item.querySelector('[data-urn^="urn:li:activity:"]');
      if (nested) return nested.getAttribute('data-urn');
      // Fallback: scan href attributes for /activity-NNN-/
      const link = item.querySelector('a[href*="/feed/update/urn:li:activity:"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/(urn:li:activity:\\d+)/);
        if (m) return m[1];
      }
      return null;
    }

    function extractAuthor(item) {
      // Same affordance as the feed: aria-label on the control-menu / hide button.
      const ctrlMenu = item.querySelector('[aria-label^="Open control menu for post by "]');
      const hideBtn = item.querySelector('[aria-label^="Hide post by "]');
      const aria = (ctrlMenu && ctrlMenu.getAttribute('aria-label'))
                || (hideBtn && hideBtn.getAttribute('aria-label'))
                || '';
      const m = aria.match(/^(?:Open control menu for post by|Hide post by)\\s+(.+?)$/);
      if (!m) return '';
      return m[1].replace(/^[^\\p{L}\\p{N}]+/u, '').trim();
    }

    // Post containers on recent-activity look like the feed: <div class="feed-shared-update-v2"> or wrapped in <li> with data-urn.
    // We grab the broadest candidate set then filter for ones that have both a URN and an author.
    const candidates = Array.from(document.querySelectorAll('[data-urn^="urn:li:activity:"], .feed-shared-update-v2, .profile-creator-shared-feed-update__container'));
    const out = [];
    const seenUrns = new Set();

    for (const item of candidates) {
      if (out.length >= maxPosts) break;
      const urn = extractUrn(item);
      if (!urn) continue;
      if (seenUrns.has(urn)) continue;
      seenUrns.add(urn);

      const author = extractAuthor(item);
      if (!author) continue;

      const ariaText = item.innerText || '';
      // Skip reposts where the original author isn't the profile owner — we want first-party content.
      // (LinkedIn marks reshares with "reposted this" / "shared a post" text near the header.)
      if (/reposted this|shared (?:a post|this)/i.test(ariaText.slice(0, 200))) continue;

      const isJobOrPoll = /Promoted|^Promoted|This is a poll|Apply for|jobs/i.test(ariaText.slice(0, 200));
      if (isJobOrPoll) continue;

      const ageDays = parseAge(ariaText);
      if (ageDays !== null && ageDays > maxAgeDays) continue;

      const textBox = item.querySelector('[data-testid="expandable-text-box"]')
                  || item.querySelector('.feed-shared-update-v2__description')
                  || item.querySelector('.update-components-text');
      const text = textBox ? (textBox.innerText || textBox.textContent || '').trim() : '';
      if (!text || text.length < 50) continue;

      // Comment count — best-effort, the social-counts row.
      let commentCount = null;
      const social = item.querySelector('.social-details-social-counts, [aria-label*="comments"]');
      if (social) {
        const cm = (social.textContent || '').match(/(\\d+)\\s+comment/i);
        if (cm) commentCount = parseInt(cm[1], 10);
      }

      const postUrl = \`https://www.linkedin.com/feed/update/\${urn}/\`;
      out.push({ postUrl, author, text, ageDays, commentCount, isJobOrPoll: false });
    }
    return out;
  })(${maxPosts}, ${maxAgeDays})`) as ScrapedPost[];

  return posts;
}

/**
 * Shuffle in-place (Fisher-Yates). Used to randomize the order priority authors
 * are visited each scan — same authors in same sequence daily is the strongest
 * "this is a bot" signal LinkedIn watches for.
 */
export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
