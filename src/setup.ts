import { launch } from './linkedin/browser.js';
import { notion } from './notion/client.js';
import { NOTION_DB_ID, CHROME_PROFILE_DIR, STATE_DIR } from './config.js';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_PROFILE_PATH = join(__dirname, 'ai', 'voice-profile.md');

async function main() {
  console.log('=== linkedin-engage setup ===\n');

  console.log(`State dir: ${STATE_DIR} ${existsSync(STATE_DIR) ? '✓' : '(will be created)'}`);
  console.log(`Chrome profile dir: ${CHROME_PROFILE_DIR} ${existsSync(CHROME_PROFILE_DIR) ? '✓ exists' : '(will be created on first launch)'}`);

  console.log('\n[1/4] Verifying Notion access...');
  try {
    const db: any = await notion.databases.retrieve({ database_id: NOTION_DB_ID });
    const title = db.title?.[0]?.plain_text ?? '(no title)';
    console.log(`  ✓ Connected to "${title}" (${NOTION_DB_ID})`);
  } catch (err: any) {
    console.error(`  ✗ FAILED: ${err.message}`);
    console.error('\n  Fix: in Notion, open your LinkedIn Comment Queue DB → "..." menu → Connections → add your integration.');
    console.error('  Also confirm NOTION_DB_ID in .env matches the 32-char ID from the DB URL.');
    process.exit(1);
  }

  console.log('\n[2/4] Verifying Claude CLI...');
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
    console.log(`  ✓ ${stdout.trim()}`);
  } catch (err) {
    console.error(`  ✗ FAILED: claude CLI not found in PATH. Install: npm install -g @anthropic-ai/claude-code`);
    process.exit(1);
  }

  console.log('\n[3/4] Checking voice profile...');
  if (existsSync(VOICE_PROFILE_PATH)) {
    console.log(`  ✓ Voice profile present: ${VOICE_PROFILE_PATH}`);
  } else {
    console.error(`  ✗ Voice profile missing: ${VOICE_PROFILE_PATH}`);
    console.error('\n  Run the wizard to generate one:');
    console.error('    npm run voice:init');
    console.error('\n  Then re-run setup. (The wizard takes ~5 minutes — 15 questions about your tone, then Claude synthesizes a personalized profile.)');
    process.exit(1);
  }

  console.log('\n[4/4] Bootstrapping Chrome profile (LinkedIn login)...');
  console.log('  Opening Chrome. Log into LinkedIn, then close the window. Cookies will persist.');
  const ctx = await launch({ headless: false });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await new Promise<void>((resolve) => {
    ctx.on('close', () => resolve());
  });
  console.log('\n✓ Setup complete. Next: `npm run scan` to draft your first batch.');
}

main().catch((err) => { console.error(err); process.exit(1); });
