// Overwrite `draft` with the polished Dan-voice short versions. Also blank final_text
// so Notion shows a single clean comment per row.
import { notion } from '../notion/client.js';
import { NOTION_DB_ID } from '../config.js';

const FINALS: Record<string, string> = {
  'Anete Vesere 🎀': "haha tbh i barely see those anymore, but the longer version is everywhere, AI-generated comments that spend 3 sentences agreeing or paraphrasing the post and sign off with a question nobody will answer. Great post btw :)",
  'Albert Santalo': "New tools rarely land in a team, people naturally avoid them when used to the old stack. The move most miss: you don't need a fancy new tool, you need invisible flows in the stack they already use. Invoices with human approval? Just a script wired into their Slack.",
  'Mudasir re': "I think at this point the real issue is filtering out the noise and knowing where to point your attention. Nobody wants to spend their workday testing new tools and updates, there's just too much out there.",
  'Marian Esco': "wow, never knew it was a thing. In every agent build i've been near, context and orchestration is where things get expensive fast, so making it a dedicated function makes sense. Congrats and good luck :)",
  'Jeremy Boissinot': "At this point LinkedIn is basically importing celebrities it can't grow natively, which means the badge is more like a press release than a platform signal.",
  'Wayne Marlton': "Oh at this point i could start a youtube channel just reviewing my DMs from the past year. One guy sent a follow-up after 4 ignored messages, addressed me by a different name and copy-pasted the exact same message... i think something broke on his end.",
  'Nick Smoot': "Why do people keep normalizing the 6am thing? Everyone's body works differently. Tried it for ~1.5 years after a timezone move, felt wrecked, zero battery by noon. Switched to 8-9am with late nights when i need them, way better than dragging out of bed in the dark.",
  'Henrik Pultz Melbye': "From what i've seen, there're plenty of $10k agency sites running the same playbook. You know that purple gradient, same \"eMpoWeRing yOur bUsIneSs\" and same broken links under the hood.",
  'Noam Nisand': "Yeah, makes sense, but there's another side of the coin. A lot of people i talk to are frustrated this kind of content doesn't get pushed by the algo, while selfies and off-topic stuff pull hundreds of likes and quality work gets buried. I see it on my feed btw.",
  'Michael Lazerow': "haha classic. i've tried a version of this where i told a potential customer instead of a reporter, worked out pretty well, but i was nervous tho.",
};

function getText(prop: any): string {
  if (!prop) return '';
  if (prop.type === 'rich_text') return prop.rich_text.map((t: any) => t.plain_text).join('');
  if (prop.type === 'title') return prop.title.map((t: any) => t.plain_text).join('');
  return '';
}

async function main() {
  let cursor: string | undefined;
  let updated = 0;
  do {
    const res: any = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter: { property: 'status', select: { equals: 'pending' } },
      start_cursor: cursor,
    });
    for (const p of res.results) {
      const author = getText(p.properties.author);
      const finalText = FINALS[author];
      if (!finalText) continue;
      await notion.pages.update({
        page_id: p.id,
        properties: {
          draft: { rich_text: [{ text: { content: finalText } }] },
        },
      });
      console.log(`✓ ${author} (${finalText.length} chars)`);
      updated++;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`\nUpdated ${updated} rows`);
}
main().catch(e => { console.error(e); process.exit(1); });
