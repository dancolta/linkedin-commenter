import { Page, ElementHandle } from 'playwright';
import { sleep, jitter } from './browser.js';
import { snapshotIncident } from './safety-check.js';

export class CommentPublishError extends Error {}
export class AlreadyCommentedError extends Error {}

export async function likePost(page: Page): Promise<{ liked: boolean; reason?: string }> {
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
  'div.ql-editor[contenteditable="true"][data-placeholder*="comment" i]',
  'div.ql-editor[contenteditable="true"][aria-placeholder*="comment" i]',
  'div.ql-editor[contenteditable="true"]',
  'div[contenteditable="true"][data-placeholder*="comment" i]',
  'div[role="textbox"][contenteditable="true"]',
];

const SUBMIT_SELECTORS = [
  'button[class*="comments-comment-box__submit"]:not([disabled])',
  'button.comments-comment-box__submit-button--cr:not([disabled])',
  'button.comments-comment-box__submit-button:not([disabled])',
  'button[data-control-name="comment.post"]:not([disabled])',
  // LinkedIn's newer comment box ships hashed/atomized class names (no stable
  // class or data-control-name), so fall back to the button's visible label.
  // It only renders once text is typed, so this can't match the count/trigger
  // buttons that also say "Comment" elsewhere on the page. :text-is() matches
  // against the innermost element wrapping the text (often a child <span>,
  // not the <button> itself) so it misses here — has-text() checks the whole
  // subtree; findEnabledSubmit() re-verifies disabled/visible state itself.
  'button:has-text("Comment")',
  'button:has-text("Post")',
  'button:has-text("Reply")',
];

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

async function findEnabledSubmit(page: Page, timeoutMs = 8_000): Promise<ElementHandle | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of SUBMIT_SELECTORS) {
      const candidates = await page.$$(sel);
      for (const c of candidates) {
        const visible = await c.isVisible().catch(() => false);
        const disabled = await c.evaluate((el: any) => el.disabled === true || el.getAttribute('aria-disabled') === 'true').catch(() => true);
        if (visible && !disabled) return c;
      }
    }
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

export async function hasMyComment(page: Page, vanity: string): Promise<boolean> {
  await sleep(jitter(800, 1400));
  await expandComments(page, 3);
  return await page.evaluate((v: string) => {
    const slug = v.toLowerCase();
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    for (const a of links) {
      const href = ((a as HTMLAnchorElement).getAttribute('href') || '').toLowerCase();
      const m = href.match(/\/in\/([^/?#]+)/);
      if (!m || m[1] !== slug) continue;
      const inComment = a.closest('article[class*="comments-comment"], div[class*="comments-comment-item"], div[class*="comments-comment-entity"]');
      if (inComment) return true;
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

  const submit = await findEnabledSubmit(page, 8_000);
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

  // Verify the editor cleared (or our comment is in DOM)
  const stillTyped = await page.evaluate((commentText: string) => {
    const editors = document.querySelectorAll('div.ql-editor[contenteditable="true"]');
    for (const e of editors) {
      const t = ((e as HTMLElement).innerText || '').trim();
      if (t === commentText.trim()) return true;
    }
    return false;
  }, comment).catch(() => false);
  if (stillTyped) {
    await snapshotIncident(page, 'submit-no-clear');
    throw new CommentPublishError('comment text still in editor after submit click');
  }

  return { liked: likeResult.liked, likeReason: likeResult.reason };
}

export async function capturePostScreenshot(page: Page, postUrl: string): Promise<Buffer | null> {
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(jitter(1500, 2500));
    const article = await page.$('article, div[role="article"]');
    if (!article) return null;
    return await article.screenshot({ type: 'png' });
  } catch {
    return null;
  }
}
