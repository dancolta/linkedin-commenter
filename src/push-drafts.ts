// Push externally-drafted comments directly to Notion as 'approved'.
// Used when the `claude -p` drafter subprocess is unavailable (e.g. running
// from inside a Claude Code session). Input JSON shape:
//   [{ postUrl, author, postText, draft }, ...]
// Usage: tsx src/push-drafts.ts <path-to-drafts.json>

import { readFileSync } from 'node:fs';
import { notion } from './notion/client.js';
import { NOTION_DB_ID } from './config.js';

interface DraftInput {
  postUrl: string;
  author: string;
  postText: string;
  draft: string;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx src/push-drafts.ts <path-to-drafts.json>');
    process.exit(1);
  }
  const drafts: DraftInput[] = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Pushing ${drafts.length} drafts to Notion as 'approved'…`);

  let ok = 0;
  for (const d of drafts) {
    if (!d.draft || d.draft === 'SKIP') continue;
    const titlePreview = `${d.author} — ${d.postText.slice(0, 40).replace(/\s+/g, ' ')}`;
    await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Name: { title: [{ text: { content: titlePreview } }] },
        post_url: { url: d.postUrl },
        author: { rich_text: [{ text: { content: d.author } }] },
        post_text: { rich_text: [{ text: { content: d.postText.slice(0, 2000) } }] },
        draft: { rich_text: [{ text: { content: d.draft } }] },
        status: { select: { name: 'approved' } },
        scanned_at: { date: { start: new Date().toISOString() } },
      } as any,
    });
    ok++;
    console.log(`  ✓ ${d.author.slice(0, 40)}`);
  }
  console.log(`\nPushed ${ok}/${drafts.length} drafts (status=approved). Run \`npm run publish\` to post.`);
}

main().catch(err => { console.error(err); process.exit(1); });
