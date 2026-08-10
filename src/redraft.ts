import { getPostText, setDraft } from './queue.js';
import { resolveTargets, reportUnmatched } from './resolve-target.js';
import { syncVault } from './vault/sync.js';
import { draftBatch } from './ai/drafter.js';
import { validateDraft } from './ai/guardrails.js';
import { getRecentComments } from './cache/sqlite.js';

const args = process.argv.slice(2);
const target = args[0];
const feedback = args.slice(1).join(' ').trim();

if (!target || !feedback) {
  console.error('Usage: npm run redraft -- <name|id> "<feedback>"   (e.g. henry "shorter, drop the question")');
  process.exit(1);
}

// Same name-first resolution as kill, so Dan can say "redraft the henry one"
// without the review-cache index having to still be accurate.
const { targets, unmatched, active } = await resolveTargets(target);
if (unmatched.length) {
  reportUnmatched(unmatched, active);
  process.exit(1);
}
if (targets.length > 1) {
  console.error(`"${target}" matches ${targets.length} drafts: ${targets.map(t => t.author).join(', ')}`);
  console.error('Redraft takes one at a time — narrow the name.');
  process.exit(1);
}

const pageId = targets[0].pageId;
const { author, postText, oldDraft } = await getPostText(pageId);

if (!author || !postText) {
  console.error(`${target}: missing author or post_text on the queue row.`);
  process.exit(1);
}

console.log(`Redrafting @${author} with steer: "${feedback}"`);
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

// Push the new text into the vault note so the folder never shows a stale draft.
try {
  await syncVault();
} catch (err) {
  console.log(`Vault resync skipped: ${(err as Error).message}`);
}

console.log(`Updated @${author}.`);
