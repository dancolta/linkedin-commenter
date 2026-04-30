import { launch, sleep } from '../linkedin/browser.js';

async function main() {
  const ctx = await launch({ headless: false });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-testid="mainFeed"]', { timeout: 20_000 });
  await sleep(4000);

  // Try clicking comment button on first no-URN post + see if URN appears
  const beforeAfter = await page.evaluate(async () => {
    const feed = document.querySelector('[data-testid="mainFeed"]');
    if (!feed) return { error: 'no feed' };
    const items = feed.querySelectorAll('[role="listitem"]');
    for (const item of items) {
      if (/urn:li:activity:\d+/.test(item.outerHTML)) continue;
      const author = item.querySelector('[aria-label^="Open control menu for post by "]')?.getAttribute('aria-label') || '';
      const commentBtn = Array.from(item.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || b.textContent || '').trim() === 'Comment');
      if (!commentBtn) return { author, error: 'no comment button' };
      const before = /urn:li:activity:\d+/.test(item.outerHTML);
      (commentBtn as HTMLElement).scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 300));
      (commentBtn as HTMLElement).click();
      await new Promise(r => setTimeout(r, 1500));
      const after = /urn:li:activity:\d+/.test(item.outerHTML);
      const urnMatch = item.outerHTML.match(/urn:li:activity:(\d+)/);
      // Press Escape via dispatched event
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { author, before, after, urn: urnMatch?.[1] ?? null };
    }
    return { error: 'all items had URN' };
  });
  console.log('CLICK_PROBE:', JSON.stringify(beforeAfter, null, 2));
  await page.keyboard.press('Escape');
  await sleep(1000);

  const dump = await page.evaluate(() => {
    const feed = document.querySelector('[data-testid="mainFeed"]');
    if (!feed) return { error: 'no mainFeed' };
    const items = feed.querySelectorAll('[role="listitem"]');
    const summary = {
      totalItems: items.length,
      withUrnInOuterHtml: 0,
      withAuthor: 0,
      withTextBox: 0,
      authorButNoUrn: [] as string[],
    };
    items.forEach(item => {
      const ctrlMenu = item.querySelector('[aria-label^="Open control menu for post by "]');
      const aria = ctrlMenu?.getAttribute('aria-label') ?? '';
      const hasAuthor = aria.length > 0;
      if (hasAuthor) summary.withAuthor++;

      const urnInHtml = /urn:li:activity:\d+/.test(item.outerHTML);
      if (urnInHtml) summary.withUrnInOuterHtml++;

      const textBox = item.querySelector('[data-testid="expandable-text-box"]');
      if (textBox) summary.withTextBox++;

      if (hasAuthor && !urnInHtml) {
        summary.authorButNoUrn.push(aria.slice(0, 80));
      }
    });
    const sample: any[] = [];
    let i = 0;
    for (const item of items) {
      if (i >= 3) break;
      i++;

      // Get the author marker (still there?)
      const ctrlMenu = item.querySelector('[aria-label^="Open control menu for post by "]');
      const hideBtn = item.querySelector('[aria-label^="Hide post by "]');
      const aria = (ctrlMenu && ctrlMenu.getAttribute('aria-label')) || (hideBtn && hideBtn.getAttribute('aria-label')) || '';

      // Old URN extraction targets
      const componentEls = Array.from(item.querySelectorAll('[componentkey]')).map(el => ({
        ck: el.getAttribute('componentkey') || '',
        tag: el.tagName,
      }));

      // Look for ANY attribute or text that contains a URN-like pattern
      const html = (item as HTMLElement).outerHTML;
      const urnMatches = Array.from(html.matchAll(/urn:li:[a-zA-Z]+:\d+/g)).map(m => m[0]).slice(0, 5);
      const activityMatches = Array.from(html.matchAll(/[Aa]ctivity[:\-_]?(\d{15,25})/g)).map(m => m[0]).slice(0, 5);
      const allUniqueAttrNames = new Set<string>();
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_ELEMENT);
      let n: Node | null = walker.currentNode;
      while (n) {
        const el = n as HTMLElement;
        for (const a of Array.from(el.attributes ?? [])) {
          allUniqueAttrNames.add(a.name);
        }
        n = walker.nextNode();
      }

      // Find ALL <a> tags
      const allAnchors = Array.from(item.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).getAttribute('href') || '')
        .filter(h => h.length > 1 && !h.startsWith('#'))
        .slice(0, 12);

      // Look for ANY URN type (activity, share, ugcPost, comment, etc.)
      const allUrns = Array.from(html.matchAll(/urn:li:[a-zA-Z]+(?::[a-zA-Z]+)?:\(?\d+\)?/g)).map(m => m[0]).slice(0, 8);

      // Pull out the viewtrackingspecs attribute value if present
      const trackingEls = Array.from(item.querySelectorAll('[viewtrackingspecs]'));
      const trackingSpecs = trackingEls.slice(0, 2).map(el => (el.getAttribute('viewtrackingspecs') || '').slice(0, 200));

      // Look for data-id attributes (LinkedIn sometimes uses these)
      const dataIdEls = Array.from(item.querySelectorAll('[data-id]'));
      const dataIds = dataIdEls.slice(0, 5).map(el => el.getAttribute('data-id'));

      sample.push({
        author_aria: aria,
        componentkeys: componentEls.slice(0, 8),
        all_urns: allUrns,
        anchors: allAnchors,
        tracking_specs: trackingSpecs,
        data_ids: dataIds,
        attr_names: Array.from(allUniqueAttrNames).filter(n => /key|urn|id|track|data-|activity/i.test(n)).slice(0, 30),
      });
    }
    return { summary, items: sample };
  });

  console.log(JSON.stringify(dump, null, 2));
  await ctx.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
