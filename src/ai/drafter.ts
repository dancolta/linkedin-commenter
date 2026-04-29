import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_PROFILE = readFileSync(join(__dirname, 'voice-profile.md'), 'utf8');

export class UsageLimitError extends Error {}
export class DrafterError extends Error {}

export interface PostInput {
  author: string;
  text: string;
}

const TEXT_TRUNCATE = 800;

export async function draftBatch(posts: PostInput[]): Promise<string[]> {
  if (posts.length === 0) return [];

  const numbered = posts.map((p, i) => {
    const text = p.text.slice(0, TEXT_TRUNCATE);
    return `### POST ${i + 1} (by ${p.author})\n${text}`;
  }).join('\n\n');

  const prompt = `${VOICE_PROFILE}

---

Below are ${posts.length} LinkedIn posts. Draft ONE comment for each, in the voice defined above, following all rules.

If a post offers nothing specific to react to, return literally: SKIP

${numbered}

---

Return ONLY a JSON array of ${posts.length} strings (one per post in order). No prose, no markdown, no code fences. Each element is either the comment text OR the literal string "SKIP". Example format:

["Counter: ~14 hours/week of...", "SKIP", "The 41/100 score..."]`;

  let stdout: string;
  try {
    const res = await execFileAsync(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--model', 'claude-sonnet-4-6'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180_000 }
    );
    stdout = res.stdout;
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() ?? '';
    const blob = `${stderr}\n${err.stdout?.toString?.() ?? ''}`.toLowerCase();
    if (blob.includes('usage limit') || blob.includes('rate limit') || blob.includes('quota')) {
      throw new UsageLimitError('Claude subscription usage limit hit');
    }
    throw new DrafterError(`claude CLI failed: ${err.message}`);
  }

  let result: any;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new DrafterError('claude CLI returned non-JSON wrapper');
  }
  const inner = (result.result ?? '').trim();
  if (!inner) throw new DrafterError('empty result from claude CLI');

  const arrayText = extractJsonArray(inner);
  if (!arrayText) throw new DrafterError(`could not parse JSON array from response: ${inner.slice(0, 200)}`);

  let arr: string[];
  try {
    arr = JSON.parse(arrayText);
  } catch (err) {
    throw new DrafterError(`JSON parse failed: ${(err as Error).message} — raw: ${arrayText.slice(0, 200)}`);
  }

  if (!Array.isArray(arr)) throw new DrafterError('parsed result is not an array');
  if (arr.length !== posts.length) {
    console.warn(`Drafter returned ${arr.length} drafts for ${posts.length} posts — padding with SKIP`);
    while (arr.length < posts.length) arr.push('SKIP');
    arr = arr.slice(0, posts.length);
  }

  return arr.map(s => (typeof s === 'string' ? s.trim() : 'SKIP'));
}

function extractJsonArray(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenceMatch) return fenceMatch[1];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

export async function draftComment(post: PostInput): Promise<string> {
  const [draft] = await draftBatch([post]);
  return draft;
}
