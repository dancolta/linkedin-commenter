import { draftComment } from './ai/drafter.js';
import { validateDraft } from './ai/guardrails.js';

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error('Usage: npm run draft:test -- "<post text>"');
    process.exit(1);
  }
  console.log('Post:\n' + text + '\n');
  console.log('Drafting...\n');
  const draft = await draftComment({ author: 'Test Author', text });
  console.log('--- Draft ---');
  console.log(draft);
  const v = validateDraft(draft, []);
  console.log(`\nValidation: ${v.ok ? '✓ PASS' : '✗ FAIL — ' + v.reason}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
