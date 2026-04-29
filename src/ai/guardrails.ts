// Banned ANYWHERE in draft (not just opener) — these are LinkedIn cope phrases + corporate sludge
export const BANNED_PHRASES_ANYWHERE = [
  // curiosity/agreement
  'curious',
  'interested to hear',
  'interested to know',
  'wondering if',
  'would love to know',
  'would love your take',
  'really resonates',
  // corporate
  'leverage',
  'synergy',
  'at the end of the day',
  'game-changer',
  'gamechanger',
  'unlock',
  'empower',
  'seamlessly',
  'robust',
  'dive in',
  'deep dive',
  "in today's fast-paced",
  'i hope this helps',
  'feel free to reach out',
  'food for thought',
  'circle back',
  'value-add',
];

// Banned at the START of a comment — opener crutches
export const BANNED_OPENERS = [
  'great post', 'love this', 'thanks for sharing', '100%', 'this!',
  "couldn't agree more", 'so true', 'spot on', 'well said', 'amazing',
  'awesome', 'incredible', 'totally agree', 'absolutely', 'preach',
  'this is gold', 'fire', 'such a good', 'great point',
  // LinkedIn-bro openers
  "i'm excited", 'hot take:', 'hot take ', 'unpopular opinion',
  'plot twist:', 'plot twist ', "here's the thing",
];

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateDraft(draft: string, recentComments: string[] = []): ValidationResult {
  const trimmed = draft.trim();
  if (trimmed === 'SKIP') return { ok: false, reason: 'drafter returned SKIP' };
  if (trimmed.length < 30) return { ok: false, reason: 'too short (<30 chars)' };
  if (trimmed.length > 280) return { ok: false, reason: 'too long (>280 chars)' };
  if (/[!]/.test(trimmed)) return { ok: false, reason: 'contains exclamation mark' };
  // Hashtag = # at start-of-string or after whitespace, followed by word chars.
  // This intentionally allows mid-word `f#ck` style censored swears.
  if (/(?:^|\s)#\w+/.test(trimmed)) return { ok: false, reason: 'contains hashtag' };
  if (containsUnicodeEmoji(trimmed)) return { ok: false, reason: 'contains emoji' };
  if (/[—–]/.test(trimmed)) return { ok: false, reason: 'contains em/en dash' };
  if (hasAntithesisStructure(trimmed)) return { ok: false, reason: 'antithesis structure (not X, Y / not X. it\'s Y / less X, more Y)' };

  const lower = trimmed.toLowerCase();
  for (const banned of BANNED_OPENERS) {
    if (lower.startsWith(banned)) return { ok: false, reason: `banned opener: "${banned}"` };
  }
  for (const banned of BANNED_PHRASES_ANYWHERE) {
    const re = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(trimmed)) return { ok: false, reason: `banned phrase: "${banned}"` };
  }

  const opener = firstWords(trimmed, 4).toLowerCase();
  for (const recent of recentComments) {
    if (firstWords(recent, 4).toLowerCase() === opener) {
      return { ok: false, reason: 'opener matches recent comment' };
    }
  }

  return { ok: true };
}

export function firstWords(s: string, n: number): string {
  return s.split(/\s+/).slice(0, n).join(' ');
}

// Only blocks Unicode emoji ranges. ASCII smileys like :) and :( pass through.
function containsUnicodeEmoji(s: string): boolean {
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u.test(s);
}

// Detects the AI-tell antithesis structure:
//   "not a content problem, a system problem"
//   "it's not X. it's Y"
//   "not X, but Y"
//   "less X, more Y"
//   "less about X, more about Y"
function hasAntithesisStructure(s: string): boolean {
  const patterns = [
    // "not a/an/the X, [the/a/an] Y" or "not a/the X. [the/a/an] Y"  (short contrast clauses)
    /\bnot\s+(?:a|an|the)\s+\w+(?:\s+\w+){0,3}[,.]\s+(?:a|an|the)\s+\w+(?:\s+\w+){0,3}\b/i,
    // "it's not X. it's Y" / "it isn't X. it's Y"
    /\bit'?s\s+not\s+\w+(?:\s+\w+){0,4}[,.]\s*it'?s\s+\w+/i,
    /\bit\s+isn'?t\s+\w+(?:\s+\w+){0,4}[,.]\s*it'?s\s+\w+/i,
    // "not X, it's Y"
    /\bnot\s+\w+(?:\s+\w+){0,4},\s*it'?s\s+\w+/i,
    // "less X, more Y" / "less about X, more about Y"
    /\bless\s+(?:about\s+)?\w+(?:\s+\w+){0,3},\s+more\s+(?:about\s+)?\w+/i,
    // "isn't X, it's Y"
    /\bisn'?t\s+(?:a|an|the)?\s*\w+(?:\s+\w+){0,3},\s*it'?s\s+\w+/i,
  ];
  return patterns.some(re => re.test(s));
}
