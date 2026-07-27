import { getPostText, setDraft } from './queue.js';
import { resolveSingleId } from './review-cache.js';
import { draftBatch } from './ai/drafter.js';
import { validateDraft } from './ai/guardrails.js';
import { getRecentComments } from './cache/sqlite.js';

const args = process.argv.slice(2);
const id = args[0];
const feedback = args.slice(1).join(' ').trim();

if (!id || !feedback) {
  console.error('Usage: npm run redraft -- <id> "<feedback>"   (e.g. 2 "shorter, drop the question")');
  process.exit(1);
}

const pageId = resolveSingleId(id);
const { author, postText, oldDraft } = await getPostText(pageId);

if (!author || !postText) {
  console.error(`#${id}: missing author or post_text on the queue row.`);
  process.exit(1);
}

console.log(`Redrafting #${id} (@${author}) with steer: "${feedback}"`);
console.log(`OLD: ${oldDraft}`);

const recent = getRecentComments(20);
const drafts = await draftBatch([
  {
    author,
    text: postText,
    qcFeedback: {
      previousDraft: oldDraft,
      issues: [feedback],
      suggestion: feedback,
    },
  },
]);

const raw = (drafts[0] ?? 'SKIP').trim();
if (raw.toUpperCase() === 'SKIP') {
  console.error('Drafter returned SKIP. No update written.');
  process.exit(2);
}

const guardrail = validateDraft(raw, recent, []);
if (!guardrail.ok) {
  console.error(`Guardrail rejected the new draft: ${guardrail.reason}`);
  console.error(`Draft was: ${raw}`);
  console.error('No update written. Try a different steer.');
  process.exit(2);
}

await setDraft(pageId, raw);
console.log(`NEW: ${raw}`);
console.log(`Updated #${id}.`);
