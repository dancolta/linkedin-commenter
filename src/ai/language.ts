// Lightweight English detector — heuristic only, no deps.
// Combines two rules:
//   (a) >75% of letter chars must be Latin (rejects Cyrillic, CJK, Arabic, Hebrew, etc.)
//   (b) at least one common English stopword present (rejects Romanian, Italian, Spanish, German, etc.)

const ENGLISH_STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'to', 'in', 'is', 'you', 'that', 'it',
  'was', 'for', 'on', 'are', 'with', 'as', 'his', 'they', 'at', 'be',
  'this', 'have', 'from', 'or', 'one', 'had', 'by', 'but', 'not', 'what',
  'all', 'were', 'we', 'when', 'your', 'can', 'said', 'there', 'use', 'an',
  'each', 'which', 'she', 'how', 'their', 'will', 'about', 'if', 'up', 'out',
  'them', 'then', 'these', 'so', 'some', 'her', 'would', 'make', 'like', 'into',
  'him', 'has', 'two', 'more', 'go', 'no', 'way', 'could', 'my', 'than',
  'first', 'been', 'who', 'its', 'now', 'people', 'just', 'because', 'good', 'each',
]);

export interface LanguageCheck {
  isEnglish: boolean;
  reason?: string;
}

export function detectEnglish(text: string): LanguageCheck {
  const trimmed = text.trim();
  if (trimmed.length < 30) return { isEnglish: false, reason: 'too short to detect' };

  const letters = trimmed.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return { isEnglish: false, reason: 'not enough letters' };

  const latin = letters.filter(c => /\p{Script=Latin}/u.test(c));
  const latinRatio = latin.length / letters.length;
  if (latinRatio < 0.75) return { isEnglish: false, reason: `${Math.round(latinRatio * 100)}% Latin (need >=75%)` };

  const words = trimmed.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  const stopwordHits = words.filter(w => ENGLISH_STOPWORDS.has(w)).length;
  if (stopwordHits === 0) return { isEnglish: false, reason: 'zero English stopwords' };

  return { isEnglish: true };
}
