// Priority authors — two roles:
//   1. NAMES: used when sorting feed-scraped posts. Names matched case-insensitive,
//      substring. So a feed-scrape author "Justin Welsh" matches `justin welsh`.
//   2. PROFILES: used by profile-scraper.ts to actively visit each author's
//      `/in/<slug>/recent-activity/all/` page during a scan. The feed alone rarely
//      surfaces all 20 priority creators, so we walk their profiles directly to
//      catch posts ≤1 day old.
//
// Slugs are required for profile-walking. To find a slug:
//   1. Open the author's LinkedIn profile in a browser
//   2. Copy everything after `/in/` and before the next `/` in the URL
//   3. Paste it into the `slug` field below
//
// If a slug is missing or wrong, profile-scraper.ts will log + skip that author
// (the name-based feed-sort still applies as a fallback).
//
// Mid-creator ICP-dense list, last reviewed 2026-05-20.

export interface PriorityProfile {
  name: string;
  slug: string | null; // null = skip profile-walk for this author (feed-sort only)
}

export const PRIORITY_PROFILES: PriorityProfile[] = [
  { name: 'Adam Robinson',         slug: 'retentionadam' },
  { name: 'Guillaume Moubeche',    slug: '-g-' },
  { name: 'Justin Welsh',          slug: 'justinwelsh' },
  { name: 'Lara Acosta',           slug: 'laraacostar' },
  { name: 'Jasmin Alić',           slug: 'alicjasmin' },
  { name: 'Tibo Louis-Lucas',      slug: 'thibaultll' },
  { name: 'Elena Verna',           slug: 'elenaverna' },
  { name: 'Kyle Poyar',            slug: 'kyle-poyar' },
  { name: 'Chris Walker',          slug: 'chriswalker171' },
  { name: 'Dave Gerhardt',         slug: 'davegerhardt' },
  { name: 'Amanda Natividad',      slug: 'amandanat' },
  { name: 'Anthony Pierri',        slug: 'anthonypierri' },
  { name: 'Daniel Murray',         slug: 'daniel-murray-marketing' },
  { name: 'Sangram Vajre',         slug: 'sangramvajre' },
  { name: 'Mark Kosoglow',         slug: 'mkosoglow' },
  { name: 'Mollie Bodensteiner',   slug: 'molliebodensteiner' },
  { name: 'Rosalyn Santa Elena',   slug: 'rosalynsantaelena' },
  { name: 'Liam Ottley',           slug: 'liamottley' },
  { name: 'Nick Saraev',           slug: 'nick-saraev' },
  { name: 'Greg Isenberg',         slug: 'gisenberg' },
];

// Lower-cased name list for substring-matching feed-scraped post authors.
// Kept as a derived export so editing PRIORITY_PROFILES is the single source of truth.
export const PRIORITY_AUTHOR_NAMES = PRIORITY_PROFILES.map(p => p.name.toLowerCase());

export function isPriorityAuthor(author: string): boolean {
  const key = author.toLowerCase();
  return PRIORITY_AUTHOR_NAMES.some(name => key.includes(name));
}
