import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.js';
import { createPending } from '../queue.js';

interface FakeRow {
  author: string;
  slug: string;
  postText: string;
  draft: string;
}

const ROWS: FakeRow[] = [
  {
    author: 'Lenny Rachitsky',
    slug: 'lennyrachitsky_best-pms-talk-to-customers',
    postText: "The best PMs I know spend more time talking to customers than building roadmaps. Every week, no exceptions. The roadmap is downstream of the conversations.",
    draft: "the roadmap is downstream of the conversations, that line lands. teams that skip the call loop end up shipping for a customer that only exists in slack.",
  },
  {
    author: 'April Dunford',
    slug: 'aprildunford_positioning-isnt-a-tagline',
    postText: "Positioning isn't a tagline. It's the context you give the buyer so they understand why your product is the best option for them. Most companies skip this and wonder why nothing converts.",
    draft: "most teams treat positioning as a copy task instead of a sales-enablement one. once the sdrs can't repeat it back, the whole funnel goes vague.",
  },
  {
    author: 'Pieter Levels',
    slug: 'pieterlevels_shipped-3-features-weekend',
    postText: "Shipped 3 features this weekend. Revenue jumped 12% on Monday. Stop planning, start shipping. Customers don't care about your roadmap, they care about what works today.",
    draft: "the planning-to-shipping ratio thing is real but only when you already have signal. shipping into silence is just expensive guessing.",
  },
  {
    author: 'Sahil Lavingia',
    slug: 'sahillavingia_solo-founder-myth',
    postText: "The solo founder thing is half lifestyle, half marketing. At some point every solo founder hits a wall where the next move needs someone else's calendar, not just yours.",
    draft: "the solo path looks clean from the outside until you hit that wall, then the question stops being 'do i need help' and starts being 'who do i actually trust with the keys'.",
  },
  {
    author: 'Jason M. Lemkin',
    slug: 'jasonlemkin_saas-churn-onboarding',
    postText: "If you have churn at month 6, the cause was written into your onboarding flow in week 1. Nobody wants to rewrite onboarding because the part that already 'works' feels untouchable.",
    draft: "the churn you see in month 6 was written into onboarding in week 1, that's the part nobody wants to admit because rewriting it means breaking the flow that's already 'working'.",
  },
  {
    author: 'Andrew Chen',
    slug: 'andrewchen_growth-loops-break-quietly',
    postText: "Growth loops look self-sustaining until they aren't. One referral source goes quiet, one platform changes its algorithm, and suddenly the input is gone and nobody noticed.",
    draft: "growth loops break quietly, that's the dangerous part. you keep reporting the same numbers for a quarter while the actual mechanism is already dead, just running on inventory.",
  },
  {
    author: 'Hiten Shah',
    slug: 'hnshah_analytics-questions-nobody-asked',
    postText: "Most product analytics setups answer questions nobody asked. The useful ones start with a real argument about what the team needs to know, not a dashboard template.",
    draft: "the useful analytics setups always start with a fight about what the team actually wants to know. the ones built from a template just give you decoration.",
  },
  {
    author: 'Des Traynor',
    slug: 'destraynor_support-tickets-user-research',
    postText: "Support tickets are the cheapest user research you'll ever do. But only if someone with product authority actually reads them weekly. Otherwise they're just venting tickets.",
    draft: "support tickets are the cheapest user research you can run, but it only works if someone with real authority to change things is the one reading them.",
  },
  {
    author: 'Sam Parr',
    slug: 'samparr_content-distribution-first-4-hours',
    postText: "The post that hits isn't always the one you spent the most time on. It's the one that got picked up by someone with reach in the first 4 hours. Distribution > polish.",
    draft: "the first 4 hours decides it, not the polish. if it doesn't catch with someone who has reach early, the algorithm reads that as 'not interesting' and starves it.",
  },
  {
    author: 'Codie Sanchez',
    slug: 'codiesanchez_acquisition-real-reason',
    postText: "Every small business acquisition I've done, the real story wasn't on the spreadsheet. The seller wanted out for personal reasons — divorce, health, exhaustion. That's what actually moves the deal.",
    draft: "the deals that close are the ones where the seller wants out for reasons that aren't on the spreadsheet. you can model the financials all day, the actual reason is always personal.",
  },
  {
    author: 'Greg Isenberg',
    slug: 'gregisenberg_community-founder-shows-up',
    postText: "Communities die when the founder stops showing up. No automated welcome flow, no community manager, no Discord bot can replace the signal that someone in charge still cares.",
    draft: "communities die the day the founder stops showing up. doesn't matter how good the discord bot or the welcome flow is, members feel the absence and start to drift.",
  },
  {
    author: 'Paul Graham',
    slug: 'paulgraham_do-things-dont-scale-second-half',
    postText: "Everyone quotes 'do things that don't scale' but skips the second half: you have to know when to stop. The founders who don't transition out of the unscalable phase get crushed by the workload.",
    draft: "everyone quotes the first half, nobody quotes the second. the trick is recognizing the moment the unscalable thing has done its job, that's the part you can't get from a tweet.",
  },
  {
    author: 'Naval',
    slug: 'naval_leverage-without-judgment',
    postText: "Leverage without judgment just amplifies your mistakes faster. Founders who scaled before they understood the unit economics learn this the expensive way.",
    draft: "leverage without judgment just makes the mistakes more expensive. that's the part the 'scale fast' crowd skips, you can't borrow your way out of bad fundamentals.",
  },
  {
    author: 'Marc Andreessen',
    slug: 'pmarca_software-eating-world-loop',
    postText: "Software ate the world but didn't eat the parts where humans need to be in the loop. The next decade of arbitrage lives in those gaps.",
    draft: "the gaps where software hands off to humans are where the actual money sits now. everything else got commoditized, the handoff is what nobody's figured out cleanly.",
  },
  {
    author: 'Wes Kao',
    slug: 'weskao_operator-playbook-copy',
    postText: "The playbook everyone copies is the one that worked once for a team you'll never meet, in conditions you can't replicate. Read it for shape, then write your own.",
    draft: "the playbook everyone shares is from a team you'll never meet, in conditions you can't replicate. read it for the shape, then throw out the specifics.",
  },
  {
    author: 'Patrick Collison',
    slug: 'patrickc_engineering-boring-rituals',
    postText: "The best engineering teams I know have the most boring rituals. Pre-commit hooks, weekly cleanup days, on-call rotations that actually rotate. The chaotic teams look exciting until there's a deadline.",
    draft: "the boring-ritual teams are the ones who ship on deadlines. the chaotic-genius energy looks fun in the demo, then everyone is up at 3am trying to remember how the deploy works.",
  },
  {
    author: 'Tim Ferriss',
    slug: 'timferriss_productivity-treadmill',
    postText: "The productivity content treadmill is itself a productivity drain. Half the people optimizing their morning routine haven't shipped anything in 6 months.",
    draft: "the productivity-optimization treadmill is the productivity drain. the people deepest in it are usually the furthest from anything they actually shipped this year.",
  },
  {
    author: 'Anu Atluru',
    slug: 'anuatluru_writers-perspective-not-utility',
    postText: "The writers I keep reading are the ones who don't try to be useful every post. Usefulness is exhausting and ages badly. Perspective lasts.",
    draft: "the writers who last aren't trying to be useful every post. usefulness ages out in a year, perspective is the only thing that keeps you readable.",
  },
  {
    author: 'Julian Shapiro',
    slug: 'julianshapiro_copywriting-formulas-ceiling',
    postText: "Copywriting advice that gives you a formula is selling you a ceiling. The writers who actually write well started by reading 10,000 ads and noticing patterns themselves.",
    draft: "the formula content sells you a ceiling. the people who actually write well read enough ads to develop taste, the formula is downstream of that, not a substitute.",
  },
  {
    author: 'Anna Burgess Yang',
    slug: 'annabyang_automation-survives-when-understood',
    postText: "The automation that survives in a company is the one where the person it serves can still explain what it does. The rest gets ripped out and rebuilt by the next hire who inherits it.",
    draft: "the automations that survive are the ones the operator can still explain in plain english. the rest get torn out the moment someone new inherits them, every time.",
  },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const seededIds: string[] = [];

console.log(`Filling queue with ${ROWS.length} rows...`);

for (let i = 0; i < ROWS.length; i++) {
  const r = ROWS[i];
  const activityId = '7' + String(Date.now()).slice(-12) + String(i).padStart(6, '0');
  const postUrl = `https://www.linkedin.com/posts/${r.slug}-activity-${activityId}`;
  const pageId = await createPending({
    author: r.author,
    postUrl,
    postText: r.postText,
    draft: r.draft,
  });
  seededIds.push(pageId);
  console.log(`  [${i + 1}/${ROWS.length}] ${r.author}`);
  if (i < ROWS.length - 1) await sleep(400);
}

const trackingPath = join(STATE_DIR, 'video-fill-ids.json');
writeFileSync(trackingPath, JSON.stringify(seededIds, null, 2));
console.log(`\nDone. ${seededIds.length} rows queued. Tracking file: ${trackingPath}`);
