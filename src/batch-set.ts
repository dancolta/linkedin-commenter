import { setDraft } from './queue.js';
import { readCache } from './review-cache.js';

const cache = readCache();
if (!cache) {
  console.error('No review cache. Run `npm run review` first.');
  process.exit(1);
}

const updates: Array<{ id: string; text: string }> = [
  {
    id: '1',
    text: `i've never skipped the 45-60 mins in comments either and it's pulled more real signal than any analytics tab (at least for me). You learn what people are actually confused about vs. what they loudly agree with, those are rarely the same thing, and by the time you start understanding the psychology behind it you can actually apply it in the field :)`,
  },
  {
    id: '6',
    text: `Been there, classic red flag, a company pushing their payment terms harder than they push the scope is usually the preview of what's coming (i think you know what i mean)`,
  },
  {
    id: '8',
    text: `Everyone i know has a 45-minute-burn story, basically the Claude Code initiation. CLAUDE.md first is what keeps the context tight enough to actually finish. On top of that i've got a separate skill that stress-tests the idea and grills me with edge case questions before i touch code, that's been the bigger unlock honestly. On the CRM bit though, moment someone else needs to log in, you want HubSpot :)`,
  },
  {
    id: '9',
    text: `That's super cool, had the same feeling when i once worked with a brand whose ambassador was Mike Tyson, the money wasn't that great but the feeling was cool af`,
  },
  {
    id: '11',
    text: `Ran into this a few weeks ago, someone showed me their AI-generated homepage and couldn't figure out why it wasn't landing. Everything basically was technically correct but the page had no opinion about where to look. Fast iteration on the wrong question :) P.S. same applies for developers and i guess any other industry which overuses AI then wonders why it doesn't bring expected results`,
  },
  {
    id: '12',
    text: `Easy to say you use AI and harder to show you know where to stop trusting it. I mean depth in a specific area is what lets you catch the model when it's confidently wrong (and i think that's a very cool skill to have)`,
  },
  {
    id: '16',
    text: `I do voice memos now for the first-draft pass... stops the brain from simulating the paragraph before it exists and just gets something down, usually takes around 5 minutes to transcribe but saves the hour and you'd be surprised how different ideas sound when you hear your voice describing 'em :)`,
  },
  {
    id: '19',
    text: `Deciding what to cut is the part i still can't delegate. Every AI-generated page comes back with something that shouldn't be there, and that judgment call is still entirely manual (sometimes i think making it from scratch would take less effort lol)`,
  },
];

let ok = 0, failed = 0;
for (const { id, text } of updates) {
  const pageId = cache.mapping[id];
  if (!pageId) {
    console.error(`#${id}: not in review cache.`);
    failed++;
    continue;
  }
  try {
    await setDraft(pageId, text);
    console.log(`✓ #${id} updated`);
    ok++;
  } catch (err: any) {
    console.error(`✗ #${id}: ${err?.message ?? err}`);
    failed++;
  }
}

console.log(`\nDone. ${ok} updated, ${failed} failed.`);
