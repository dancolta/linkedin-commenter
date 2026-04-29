import { notion } from './client.js';
import { NOTION_DB_ID } from '../config.js';

export type QueueStatus = 'pending' | 'approved' | 'publishing' | 'published' | 'failed' | 'skipped' | 'deferred';

export interface QueueRow {
  pageId: string;
  postUrl: string;
  author: string;
  postText: string;
  draft: string;
  finalText: string | null;
  status: QueueStatus;
}

export async function createPending(input: {
  author: string;
  postUrl: string;
  postText: string;
  draft: string;
  screenshotUrl?: string;
}): Promise<string> {
  const titlePreview = `${input.author} — ${input.postText.slice(0, 40).replace(/\s+/g, ' ')}`;
  const props: any = {
    'Name': { title: [{ text: { content: titlePreview } }] },
    'post_url': { url: input.postUrl },
    'author': { rich_text: [{ text: { content: input.author } }] },
    'post_text': { rich_text: [{ text: { content: input.postText.slice(0, 2000) } }] },
    'draft': { rich_text: [{ text: { content: input.draft } }] },
    'status': { select: { name: 'pending' } },
    'scanned_at': { date: { start: new Date().toISOString() } },
  };
  if (input.screenshotUrl) {
    props.screenshot = { files: [{ name: 'post.png', external: { url: input.screenshotUrl } }] };
  }
  const res = await notion.pages.create({ parent: { database_id: NOTION_DB_ID }, properties: props });
  return res.id;
}

export async function listApproved(): Promise<QueueRow[]> {
  const res = await notion.databases.query({
    database_id: NOTION_DB_ID,
    filter: { property: 'status', select: { equals: 'approved' } },
  });
  return res.results.map(toRow).filter(Boolean) as QueueRow[];
}

export async function listOpenAuthors(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const status of ['pending', 'approved', 'publishing'] as const) {
    let cursor: string | undefined;
    do {
      const res: any = await notion.databases.query({
        database_id: NOTION_DB_ID,
        filter: { property: 'status', select: { equals: status } },
        start_cursor: cursor,
      });
      for (const page of res.results) {
        const author = (page.properties?.author?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
        if (author) out.add(author.toLowerCase());
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  }
  return out;
}

export async function markStatus(pageId: string, status: QueueStatus, extras?: { reason?: string; publishedAt?: Date }): Promise<void> {
  const props: any = { status: { select: { name: status } } };
  if (extras?.reason) props.reason = { rich_text: [{ text: { content: extras.reason.slice(0, 500) } }] };
  if (extras?.publishedAt) props.published_at = { date: { start: extras.publishedAt.toISOString() } };
  await notion.pages.update({ page_id: pageId, properties: props });
}

export async function archivePage(pageId: string): Promise<void> {
  await notion.pages.update({ page_id: pageId, archived: true });
}

export async function countByStatus(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let cursor: string | undefined;
  do {
    const res: any = await notion.databases.query({ database_id: NOTION_DB_ID, start_cursor: cursor });
    for (const page of res.results) {
      const row = toRow(page);
      if (row) counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return counts;
}

function toRow(page: any): QueueRow | null {
  const props = page.properties;
  if (!props) return null;
  return {
    pageId: page.id,
    postUrl: props.post_url?.url ?? '',
    author: extractText(props.author),
    postText: extractText(props.post_text),
    draft: extractText(props.draft),
    finalText: extractText(props.final_text) || null,
    status: (props.status?.select?.name ?? 'pending') as QueueStatus,
  };
}

function extractText(prop: any): string {
  if (!prop?.rich_text) return '';
  return prop.rich_text.map((t: any) => t.plain_text ?? '').join('');
}
