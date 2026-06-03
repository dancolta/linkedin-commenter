// Banned ANYWHERE in draft (not just opener) — these are LinkedIn cope phrases + corporate sludge
export const BANNED_PHRASES_ANYWHERE = [
  // curiosity/agreement — block the cope variants, but NOT the pointed
  // "curious how/what you [specific]" close the voice profile recommends.
  'curious to hear',
  'curious to know',
  'curious what others',
  'curious if anyone',
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
  // debate-bro tells (warm-contrarian anti-patterns)
  'hard pass',
  'this is wrong because',
  'that\'s just not true',
  "i'd argue that",
  'let me play devil',
  'with all due respect',
  'respectfully',
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
  // debate-bro openers (warm-contrarian anti-patterns)
  'actually,', 'actually ', 'disagree.', 'disagree ', 'disagree—',
  'sorry but', 'sorry, but',
];

// Fabrication tells — specific personal-event language the drafter has no business inventing.
// The model has no access to Dan's actual recent life, so any draft that drops a concrete
// timeframe (last week / last quarter / yesterday / ~N months) attached to a personal verb
// is presumed invented and rejected. The fix is always to swap to a hedged-generic shape
// ("the version I keep running into is..."). See FABRICATION GUARD in voice-profile.md.
const FABRICATION_PATTERNS: RegExp[] = [
  // Specific dated timeframes anywhere — the strongest signal of invented biography.
  // Matches "last week/month/quarter/year", "yesterday", "this morning/week/month/quarter",
  // "a few weeks/months ago", "N days/weeks/months ago" — regardless of subject.
  // Reason: there's no legitimate use case for these in Dan-voice comments. Even when Dan
  // wants to reference a recurring pattern, he'd say "the version I keep running into" —
  // never "last week". If a real Dan-said example contains "last week", it should be saved
  // to good-drafts.md and referenced via the vibe-injection path, not generalized.
  /\b(?:last|this)\s+(?:week|month|quarter|year)\b/i,
  /\byesterday\b/i,
  /\ba\s+few\s+(?:weeks|months|days)\s+ago\b/i,
  /\b\d+\s+(?:days?|weeks?|months?)\s+ago\b/i,
  // Invented duration claims: "for ~N months", "for around N months", "N months in"
  /\bfor\s+(?:~|around\s+|about\s+)?\d+\s+(?:months?|weeks?|years?)\b/i,
  /\b~?\d+\s+months?\s+in\b/i,
  // Named-relationship anecdote shapes — "my friend", "a friend's deal", "my co-founder",
  // "a client of ours". Any of these implies a specific real person Dan knows.
  /\b(?:a|my)\s+(?:friend|client|co-founder|cofounder|coworker)(?:'s)?\b/i,
  // First-person past-tense action verbs without a hedging frame.
  // Allowed: "I keep running into", "When I run into", "I tend to". Banned: "Tried this",
  // "Walked X", "Watched X" as bare opener verbs implying a specific event.
  /^(?:Tried|Walked|Watched|Ran into|Built|Shipped|Tested|Spent)\b/m,
];

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

// First-word buckets we want to cap. A draft whose first word falls in this set
// gets rejected if the same bucket is already overused in the (recent + batch) pool.
// "Yeah", "Honestly", "Kinda", "Same" are the four discourse-marker openers Dan
// uses but doesn't want stacked. Anything else (first-person verbs, scene openers,
// "Ran", "Watched", "Hmm", "Wait", etc.) is unrestricted.
const RATIONED_FIRST_WORDS = new Set(['yeah', 'honestly', 'kinda', 'same']);
const OVERUSE_RATIO = 0.25; // max 25% of the pool can share the same rationed first word
const POOL_MIN = 4;          // small pools allow up to 1 occurrence (1/4 = 25%)

function firstWord(s: string): string {
  const m = s.trim().match(/^[\w']+/);
  return m ? m[0].toLowerCase() : '';
}

export function validateDraft(
  draft: string,
  recentComments: string[] = [],
  batchAcceptedDrafts: string[] = [],
): ValidationResult {
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

  // Fabrication guard — runs before phrase bans so the reason is specific.
  for (const re of FABRICATION_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, reason: 'fabrication: invented personal event/timeframe (see FABRICATION GUARD)' };
    }
  }

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

  // First-word overuse check: cap rationed discourse-marker openers across recent + batch.
  const draftFirst = firstWord(trimmed);
  if (RATIONED_FIRST_WORDS.has(draftFirst)) {
    const pool = [...recentComments, ...batchAcceptedDrafts];
    const poolSize = Math.max(pool.length + 1, POOL_MIN); // +1 to include this draft
    const sameCount = pool.filter(c => firstWord(c) === draftFirst).length + 1;
    if (sameCount / poolSize > OVERUSE_RATIO) {
      return { ok: false, reason: `first-word overused: "${draftFirst}" (${sameCount}/${poolSize} > 25%)` };
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
