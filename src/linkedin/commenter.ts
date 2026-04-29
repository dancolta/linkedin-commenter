import { Page, ElementHandle } from 'playwright';
import { sleep, jitter } from './browser.js';
import { snapshotIncident } from './safety-check.js';

export class CommentPublishError extends Error {}

export async function likePost(page: Page): Promise<{ liked: boolean; reason?: string }> {
  // Find the post-level Like button. Comment-level Like buttons have aria-label
  // that includes "comment" — exclude those.
  const candidates = await page.$$('button[aria-label]');
  for (const btn of candidates) {
    const aria = (await btn.getAttribute('aria-label'))?.toLowerCase() ?? '';
    if (!/^(react like|like)\b/.test(aria)) continue;
    if (aria.includes('comment')) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;

    const pressed = await btn.evaluate((el: any) => el.getAttribute('aria-pressed') === 'true').catch(() => false);
    if (pressed) return { liked: false, reason: 'already liked' };

    await btn.click().catch(() => {});
    await sleep(jitter(700, 1400));
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

export async function publishComment(page: Page, postUrl: string, comment: string): Promise<{ liked: boolean; likeReason?: string }> {
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(jitter(1500, 3000));

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

  await submit.click();
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
