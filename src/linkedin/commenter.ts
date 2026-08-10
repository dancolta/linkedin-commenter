import { Page, ElementHandle } from 'playwright';
import { sleep, jitter } from './browser.js';
import { snapshotIncident } from './safety-check.js';

export class CommentPublishError extends Error {}
export class AlreadyCommentedError extends Error {}

async function likePost(page: Page): Promise<{ liked: boolean; reason?: string }> {
  // LinkedIn's post-level reaction toggle has aria-label "Reaction button state: Like"
  // (already liked) or "Reaction button state: no reaction" (not liked yet) — it does
  // NOT use "aria-pressed". Comment-level like buttons use a different aria-label
  // ("Like" alone, or containing "comment"), so anchoring on "Reaction button state:"
  // scopes this to the post itself.
  const candidates = await page.$$('button[aria-label^="Reaction button state"]');
  for (const btn of candidates) {
    const aria = (await btn.getAttribute('aria-label')) ?? '';
    if (!(await btn.isVisible().catch(() => false))) continue;

    if (/reaction button state:\s*like$/i.test(aria)) return { liked: false, reason: 'already liked' };

    await btn.click().catch(() => {});
    await sleep(jitter(700, 1400));
    // Clicking the reaction button opens LinkedIn's reaction-picker tooltip
    // (love/celebrate/support/etc, rendered in a floating-ui-portal). It can
    // linger positioned over nearby controls (e.g. the comment submit button)
    // and intercept their clicks. Move the mouse away and dismiss it.
    await page.mouse.move(10, 10).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(jitter(300, 600));
    return { liked: true };
  }
  return { liked: false, reason: 'like button not found' };
}

const EDITOR_SELECTORS = [
  // LinkedIn migrated the comment box from Quill (div.ql-editor) to
  // TipTap/ProseMirror. The new editor carries no stable class — every class is
  // a build-hashed atom — so anchor on the ARIA contract, which survived the
  // migration. The legacy Quill selectors are kept last as a fallback in case
  // the old box is still served to some sessions.
  'div[role="textbox"][contenteditable="true"][aria-label*="comment" i]',
  'div.tiptap[role="textbox"][contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
  'div.ql-editor[contenteditable="true"]',
];

const SUBMIT_LABELS = ['comment', 'post', 'reply'];

const TRIGGER_SELECTORS = [
  'button[aria-label="Comment"]:not([aria-pressed])',
  'button.comments-comment-box__trigger',
];

async function findVisibleEditor(page: Page, timeoutMs = 10_000): Promise<ElementHandle | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of EDITOR_SELECTORS) {
      const candidates = await page.$$(sel);
      for (const c of candidates) {
        if (await c.isVisible().catch(() => false)) return c;
      }
    }
    await sleep(400);
  }
  return null;
}

/**
 * Resolve the comment box's own submit button.
 *
 * This MUST be scoped to the editor. A page-wide `button:has-text("Comment")`
 * lookup matches the post action-bar's "Comment" trigger first (it sits above
 * the editor in DOM order), and clicking that just re-focuses the box — the
 * comment is silently never posted. That was the actual publish failure.
 *
 * Both buttons render identical hashed classes, so the only stable
 * discriminator is containment: walk up from the editor and take the first
 * ancestor whose subtree holds a submit-labelled button. The comment box is a
 * much tighter subtree than the post, so it is reached long before the
 * ancestor that also encloses the action bar.
 */
async function findEnabledSubmit(page: Page, editor: ElementHandle, timeoutMs = 8_000): Promise<ElementHandle | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handle = await editor.evaluateHandle((ed: Element, labels: string[]) => {
      // NB: keep every helper here an inline anonymous arrow. A named function
      // const gets compiled to an esbuild `__name(...)` call, which is not
      // defined inside the page context and throws at evaluate time.
      let node: Element | null = ed.parentElement;
      for (let depth = 0; node && depth < 10; depth++) {
        const hits = Array.from(node.querySelectorAll('button')).filter(b => {
          const btn = b as HTMLButtonElement;
          const text = (btn.innerText || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
          if (!labels.includes(text) && !labels.includes(aria)) return false;
          if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
          return btn.offsetParent !== null;
        });
        // Stop at the first ancestor that contains exactly one submit-labelled
        // button. More than one means we have climbed past the comment box and
        // swept in the action bar too — that is ambiguous, so refuse it.
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) return null;
        node = node.parentElement;
      }
      return null;
    }, SUBMIT_LABELS);

    const el = handle.asElement();
    if (el) return el;
    await handle.dispose();
    await sleep(400);
  }
  return null;
}

async function expandComments(page: Page, maxClicks = 3): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    const buttons = await page.$$([
      'button.comments-comments-list__load-more-comments-button',
      'button[aria-label*="previous comment" i]',
      'button[aria-label*="more comment" i]',
      'button[aria-label*="show more replies" i]',
      // Hashed-class rebuild: the load-more control now carries no stable class
      // or aria-label, only its visible label.
      'button:has-text("Load more comments")',
      'button:has-text("See previous replies")',
    ].join(','));
    let clicked = false;
    for (const b of buttons) {
      if (await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        clicked = true;
        await sleep(jitter(900, 1600));
        break;
      }
    }
    if (!clicked) break;
  }
}

async function hasMyComment(page: Page, vanity: string): Promise<boolean> {
  await sleep(jitter(800, 1400));
  // The comment list renders lazily and can take several seconds to hydrate.
  // A single fixed wait is not enough — it reported "no comment by me" on a
  // post that demonstrably had one. Scroll and re-check across a few rounds,
  // returning as soon as a match appears.
  for (let round = 0; round < 4; round++) {
    await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
    await sleep(jitter(1200, 1800));
    await expandComments(page, 2);
    if (await scanForMyComment(page, vanity)) return true;
  }
  return false;
}

async function scanForMyComment(page: Page, vanity: string): Promise<boolean> {
  return await page.evaluate((v: string) => {
    const slug = v.toLowerCase();
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    for (const a of links) {
      const href = ((a as HTMLAnchorElement).getAttribute('href') || '').toLowerCase();
      const m = href.match(/\/in\/([^/?#]+)/);
      if (!m || m[1] !== slug) continue;

      // The `comments-comment-*` container classes this used to match were
      // removed when LinkedIn rebuilt the comment list with hashed classes, so
      // this always returned false — silently disabling the already-commented
      // guard. Identify a comment by its structure instead: a comment entry is
      // the nearest ancestor of the author link that also owns that comment's
      // own Reply control. The global nav and the left profile card also link
      // to /in/<me>, but neither sits near a Reply button.
      let node: Element | null = a.parentElement;
      for (let depth = 0; node && depth < 8; depth++) {
        const hasReply = Array.from(node.querySelectorAll('button')).some(b => {
          const text = (b.innerText || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          return text === 'reply' || aria === 'reply' || aria.startsWith('reply to');
        });
        if (!hasReply) { node = node.parentElement; continue; }

        // A Reply button alone is not proof. The nav avatar, the left profile
        // card and the comment box all link to /in/<me>, and climbing far
        // enough from any of them eventually reaches a container that happens
        // to enclose some other person's Reply button — measured at 22-25
        // profile links for those. A real comment entry encloses only its own
        // author (plus the odd @mention), so require a tight container.
        const profileLinks = node.querySelectorAll('a[href*="/in/"]').length;
        if (profileLinks <= 3) return true;
        // Too wide to be a single comment — this link is the nav avatar, the
        // profile card or the comment box, not a posted comment. Give up on
        // THIS link and try the next one; do not conclude "no comment by me",
        // because the real comment is usually a later link in the list.
        break;
      }
    }
    return false;
  }, vanity);
}

/**
 * Open the post URL and check if the logged-in user (vanity) has a comment in
 * the rendered thread. Used at scan time to prevent re-queueing posts the user
 * already commented on manually.
 */
export async function checkIAlreadyCommented(page: Page, postUrl: string, vanity: string): Promise<boolean> {
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await sleep(jitter(1500, 2500));
    return await hasMyComment(page, vanity);
  } catch {
    return false; // Don't block on transient errors; the publish-time guard will still catch.
  }
}

export async function publishComment(page: Page, postUrl: string, comment: string, myVanity: string | null): Promise<{ liked: boolean; likeReason?: string }> {
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(jitter(1500, 3000));

  if (myVanity && await hasMyComment(page, myVanity)) {
    throw new AlreadyCommentedError(`already commented on this post as /in/${myVanity}/`);
  }

  // Like the post first (humans typically react before commenting)
  const likeResult = await likePost(page);
  await sleep(jitter(800, 1500));

  // First try: editor already visible (some posts auto-expand the comment box)
  let editor = await findVisibleEditor(page, 3_000);

  // If not visible, click the Comment trigger to expand
  if (!editor) {
    let trigger: ElementHandle | null = null;
    for (const sel of TRIGGER_SELECTORS) {
      const t = await page.$(sel);
      if (t && await t.isVisible().catch(() => false)) { trigger = t; break; }
    }
    if (trigger) {
      await trigger.click().catch(() => {});
      await sleep(jitter(1200, 2000));
    }
    editor = await findVisibleEditor(page, 8_000);
  }

  if (!editor) {
    await snapshotIncident(page, 'no-comment-editor');
    throw new CommentPublishError('comment editor not found after trigger click');
  }

  await editor.click();
  await sleep(jitter(400, 900));

  // Clear any existing draft (LinkedIn autosaves on previous typing)
  await page.keyboard.press('Meta+A').catch(() => {});
  await sleep(150);
  await page.keyboard.press('Delete').catch(() => {});
  await sleep(jitter(200, 500));

  for (const char of comment) {
    await page.keyboard.type(char);
    await sleep(jitter(35, 90));
    if (Math.random() < 0.04) await sleep(jitter(200, 500));
  }

  await sleep(jitter(600, 1200));

  const submit = await findEnabledSubmit(page, editor, 8_000);
  if (!submit) {
    await snapshotIncident(page, 'no-submit-button');
    throw new CommentPublishError('submit button not found or still disabled after typing');
  }

  try {
    await submit.click({ timeout: 10_000 });
  } catch {
    // A stray overlay (reaction-picker tooltip, toast, etc.) may still be
    // intercepting the point. Dismiss and force the click through directly
    // on the button — safe here since we've already resolved the exact
    // enabled submit element via findEnabledSubmit().
    await page.mouse.move(10, 10).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(jitter(300, 600));
    await submit.click({ force: true });
  }
  await sleep(jitter(2500, 4500));

  const url = page.url();
  if (url.includes('/checkpoint/') || url.includes('/uas/login')) {
    await snapshotIncident(page, 'submit-redirect');
    throw new CommentPublishError(`unexpected redirect after submit: ${url}`);
  }

  // Confirm the comment actually landed.
  //
  // This check used to be negative — "is my text still sitting in the editor?"
  // — against `div.ql-editor`, a selector LinkedIn had already removed. It
  // matched nothing, so it answered "no" on every run and reported success for
  // 11 comments that were never posted. Never infer success from the absence of
  // a failure marker: require positive proof that the comment is in the thread.
  //
  // Proof = the comment text rendered somewhere on the page that is NOT the
  // editor. Text is exact and unique here, so this needs no stable class names.
  const landed = await page.waitForFunction(
    (commentText: string) => {
      const needle = commentText.trim().replace(/\s+/g, ' ');
      if (!needle) return false;
      const editors = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div.ql-editor[contenteditable="true"]'));
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let hay = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (editors.some(e => e.contains(n))) continue;
        hay += ' ' + (n.textContent || '');
      }
      // LinkedIn truncates long comments behind a "…more" toggle, so match on a
      // leading slice rather than the whole string.
      const probe = needle.slice(0, 80);
      return hay.replace(/\s+/g, ' ').includes(probe);
    },
    comment,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);

  if (!landed) {
    await snapshotIncident(page, 'comment-not-in-thread');
    throw new CommentPublishError('submit clicked but comment never appeared in the thread');
  }

  return { liked: likeResult.liked, likeReason: likeResult.reason };
}

