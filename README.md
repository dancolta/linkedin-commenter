<p align="center">
  <img src="./assets/demo.gif" alt="linkedin-commenter demo" width="800">
</p>

<h1 align="center">linkedin-commenter</h1>

<p align="center">
  <strong>Auto-draft LinkedIn comments in your voice. Approve in Notion. Publish on a real Chrome profile. Never get flagged.</strong>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node-%3E=20-339933?logo=node.js&logoColor=white">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-headed-2EAD33?logo=playwright&logoColor=white">
  <img alt="Notion" src="https://img.shields.io/badge/Notion-queue-000000?logo=notion&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-personal_use_only-orange">
</p>

---

> **⚠️ Before you use this — read the disclaimer**
>
> LinkedIn's [User Agreement §8.2](https://www.linkedin.com/legal/user-agreement) prohibits scraping, automation, and any "software, devices, scripts, robots, or other means" interacting with the platform. **This tool does that.** Manual approval and human-paced typing keep detection low, and many people run tools like this for months without issue, but the risk is real and it's on you. Account restrictions, pauses, or bans are not the repo's problem.
>
> Use it for **personal engagement on accounts you own.** Not for mass outreach, not for spam, not for managing accounts on behalf of clients without their explicit consent. Provided as-is, no warranty, no support.
>
> By cloning, installing, or running this code you accept these terms.

---

## Why this exists

LinkedIn's feed is mostly slop. AI-generated motivational posts. Engagement-bait threads. Recycled hot takes. Broetry stacks. "I just got rejected from 47 jobs and here's what I learned" carousels. Filtering that manually for posts actually worth a reply means scrolling 30-40 minutes a day, most of which gets you nothing.

The obvious response is full automation. But that makes things worse. Auto-comment bots turn LinkedIn into bots talking to bots, and your account becomes one of them. The whole point of commenting is that someone reads it and thinks "this person actually has a take." That breaks the second the comment is something a script generated and pushed without you ever seeing it.

So this tool sits in the middle. **You** define what posts matter (keywords, authors to focus on, authors to skip). **The tool** scrapes your feed, applies your filters, drafts comments in your voice, and queues them in Notion. **You** read each post, sanity-check the draft, edit if the model missed something, then publish the batch.

10-15 minutes instead of 30-40. Same engagement output. You know exactly what went out under your name, every time.

No daemon. No auto-publish. No "5-minute undo" magic. Every comment passes through your eyes before it's live.

## What it does

You, the worker, and Notion form a three-step loop:

1. **You run `npm run scan`.** A real Chrome window opens, scrolls your LinkedIn feed, and pulls 20-30 recent posts. They're filtered against your targeting rules (keywords / author allowlist / author blacklist) plus the universal cleanup filters (English only, not job listings, not reposts, not authors you've already commented on this fortnight, not posts drowning in 150+ comments, etc.). Survivors get drafted in **your** voice via Claude in a single batched call. Each draft is validated against ~12 anti-cope guardrails (no em-dashes, no "great post" openers, no antithesis structures, no exclamation marks, no hashtags, etc.). Survivors land in your Notion DB as `pending`.

2. **You approve in Notion.** Open the DB on web, mobile, or via the Claude app + Notion MCP. Read each post, read the draft, tweak the wording if needed, flip status to `approved`. Or skip / archive what you don't want to engage with.

3. **You run `npm run publish`.** The worker reads everything you approved, opens Chrome again, and for each row: pre-flight account-health check, navigate to the post, click Like, type the comment at human speed, submit, verify it published, archive the row. Cooldowns between publishes are 30-120s. Daily cap ramps from 5 to 15 over a week.

Nothing publishes without your explicit approval. Nothing runs without you typing a command. There is no daemon.

## Targeting (what gets drafted)

Four optional env vars in `.env` control which posts make it into the queue. All are pipe-separated, all are case-insensitive substring matches. Leave them blank to draft for everything that survives the universal filters.

| Var | Effect |
|---|---|
| `ONLY_AUTHORS` | Whitelist. If set, ONLY draft for posts from these authors. Use for "I want to engage with these specific 30 people." |
| `SKIP_AUTHORS` | Blacklist. Never draft for these authors. Use for hustle bros, recruiters in your niche, motivational-quote bots. |
| `ONLY_KEYWORDS` | Topic whitelist. If set, ONLY draft for posts whose text contains at least one of these. Use to focus on your wheelhouse. |
| `SKIP_KEYWORDS` | Topic blacklist. Skip posts containing any of these. Use to filter out engagement-bait phrases or topics you don't want to touch. |

Example `.env` for an indie founder writing about B2B SaaS:

```env
ONLY_KEYWORDS=b2b saas|gtm|pricing|onboarding|founder-led sales|product-market fit
SKIP_KEYWORDS=hot take|grateful to announce|game-changer|crypto|nft|web3
SKIP_AUTHORS=hustle bro|crypto guru|cold outreach guru
```

The filters apply before the Claude draft call, so they save tokens and time. Reasons surface in the scan summary so you can see what got skipped and why:

```
Filtered/skipped: 18
  6× post does not match ONLY_KEYWORDS
  4× author on SKIP_AUTHORS list
  3× post matches SKIP_KEYWORDS
  ...
```

## What makes it safe

| Layer | What it does |
|---|---|
| **Manual approval gate** | Every comment has to be flipped to `approved` in Notion by a human. Nothing auto-publishes. |
| **Per-user voice profile** | 15-question wizard generates a `voice-profile.md` from your answers + writing samples. Drafts sound like you, not like ChatGPT. |
| **12+ output guardrails** | Em/en dashes, antithesis structures, banned phrases, opener repeats, exclamation marks, hashtags, emoji — all auto-rejected before reaching Notion. |
| **Real Chrome profile** | Headed Playwright on a persistent profile. `navigator.webdriver` is false. No headless. No paste. Types at 35-90ms/key with random pauses. |
| **Phased volume ramp** | 5/day for first 3 days, then 10/day, then 15/day at steady state. Same-author cooldown of 14 days. |
| **Pre-publish health check** | Loads `/feed/` and scans for restriction language before each batch. If detected: PAUSED flag set, screenshot saved, halt. |
| **Kill switches** | `LINKEDIN_PAUSE=1` env var, `~/.linkedin-commenter/PAUSED` file, or 3 consecutive failures auto-halt. |

## Who this is for

- Founders / operators / consultants who want to engage 5-15x/day on LinkedIn without writing each comment from scratch.
- Anyone whose voice is distinctive enough that generic comment templates feel like betrayal.
- Engagement-as-pipeline people who care about account longevity more than 90-day growth hacking.

If you want auto-publish, scheduled posting, or a hands-off cron job, this is not that tool. By design.

## Quick start

```bash
git clone https://github.com/<you>/linkedin-commenter && cd linkedin-commenter
npm install
npx playwright install chromium
cp .env.example .env        # fill NOTION_TOKEN + NOTION_DB_ID

npm run voice:init          # 15-question wizard → generates your personalized voice profile
npm run setup               # verifies Notion + claude CLI + Chrome login
npm run scan                # scrape + batch-draft + queue (~2-3 min)
# approve drafts in Notion
npm run publish             # like + publish approved comments
npm run status              # phase, today's count vs cap, paused state, queue counts
```

> **Optional**: there's a Claude Code skill wrapper that lets you trigger the same flow via `/linkedin-comment run|post|status|setup`. It's not bundled with the repo — see [Optional skill wrapper](#optional-skill-wrapper) at the bottom if you want to set it up.

## Table of contents

1. [How it works](#how-it-works)
2. [Targeting (what gets drafted)](#targeting-what-gets-drafted)
3. [Edge cases & guardrails](#edge-cases--guardrails)
4. [Voice (your own, generated)](#voice-your-own-generated)
5. [Account safety](#account-safety)
6. [Failure modes & recovery](#failure-modes--recovery)
7. [Notion DB schema](#notion-db-schema)
8. [Setup](#setup)
9. [Project layout](#project-layout)
10. [Stack](#stack)
11. [Out of scope](#out-of-scope)
12. [Optional skill wrapper](#optional-skill-wrapper)

---

## How it works

```
npm run scan
  1. Open Chrome (real persistent profile, headed)
  2. Navigate to /feed/, wait for [data-testid="mainFeed"]
  3. Scroll the feed, extract posts via stable selectors:
         - listitem wrapper:  [role="listitem"]
         - author name:       aria-label="Open control menu for post by <name>"
         - post body:         [data-testid="expandable-text-box"]
         - activity URN:      protobuf-decoded from "componentkey" attribute
  4. Close Chrome (release profile lock for publish later)
  5. Filter eligible posts (10+ rules — see Edge cases)
  6. ONE batched `claude -p` call drafts all eligible in a single JSON array
  7. Validate each draft against guardrails (12+ checks)
  8. Push survivors to Notion as status=pending

[ approve drafts in Notion (UI directly, or via Claude app + Notion MCP) ]

npm run publish
  1. Pre-flight account health check (load /feed/, scan for restriction language)
  2. For each approved row, with cooldown gaps:
         re-check guardrails →
         navigate to post URL →
         click Like (if not already pressed) →
         wait, type comment 35-90ms/key →
         click submit, verify editor cleared
  3. On success: status=published, archive Notion row, record SQLite history
  4. On 3 consecutive failures: write PAUSED flag, halt
```

**Key efficiency wins:**

- Single batched `claude -p` call drafts N posts (voice profile sent once, not N times) — ~5x token reduction
- Chrome closed before drafting → no idle browser window during the slow Claude call
- Cooldowns tuned to real human-engagement cadence (45-120s in ramp, not 6-15 min)

---

## Edge cases & guardrails

Three concentric defenses. A post must pass **all of them** to get published.

### Layer 1 — Pre-draft filters (`scan.ts`, before any Claude call)

| Filter | Rule | Reason |
|---|---|---|
| Post too short | `<50 chars` | Not enough to react to |
| Job or poll | `isJobOrPoll` heuristic | Wrong content type |
| Stale post | `ageDays > 7` | Old news, low signal |
| Drowned post | `commentCount > 150` | Your comment vanishes in the noise |
| Already seen | `seen_posts` SQLite | Cross-run dedup, prevents re-queue |
| Same author <14 days | `author_history` SQLite | Looks robotic, may flag profile |
| `SKIP_AUTHORS` match | env var, substring | You don't want to engage with them |
| Not in `ONLY_AUTHORS` | env var, substring | If allowlist is set and author isn't on it |
| `SKIP_KEYWORDS` match | env var, substring on post text | Off-topic / engagement bait |
| No `ONLY_KEYWORDS` match | env var, substring on post text | If topic allowlist is set and post doesn't match |
| Same author this scan | in-batch `Set<author>` | Within-run dedup |
| Same author already pending | `listOpenAuthors()` Notion query | Approved/pending row exists, don't queue twice |
| Non-English post | `detectEnglish()` heuristic | <75% Latin chars OR zero English stopwords |

See [Targeting](#targeting-what-gets-drafted) for how to configure the four env-var filters.

### Layer 2 — Drafter output validation (`guardrails.ts`, before Notion write)

| Check | Rejects if |
|---|---|
| Drafter abstained | Output literally equals `SKIP` |
| Length min | `<30 chars` |
| Length max | `>280 chars` |
| Exclamation marks | Any `!` present |
| Hashtags | `#word` after start-of-string or whitespace (allows mid-word `f#ck` censored swears) |
| Unicode emoji | Any codepoint in emoji ranges |
| Em/en dash | Any `—` or `–` (use period/comma/semicolon instead) |
| Antithesis structure | `not X, Y` / `it's not X. it's Y` / `less X, more Y` / `isn't X, it's Y` patterns |
| Banned opener | First word matches any of 24 phrases (great post, love this, hot take, etc.) |
| Banned anywhere | 22 phrases (curious, leverage, synergy, game-changer, …) |
| Opener repeats | First 4 words match any of last 20 published comments |

### Layer 3 — Pre-publish re-checks (`publish.ts`, immediately before each publish)

| Check | Action |
|---|---|
| `LINKEDIN_PAUSE=1` env | Exit immediately |
| `~/.linkedin-commenter/PAUSED` file | Exit immediately |
| Daily cap already hit | Exit, mark remaining as `deferred` |
| Pre-flight health check | Load `/feed/`, scan body text for restriction language → if hit, screenshot + write PAUSED + exit code 2 |
| Re-validate edited text | Final text (after your manual edits) goes through guardrails again |
| 14-day same-author re-check | Mark `skipped` if author was published since draft was approved |
| Daily cap mid-batch | Defer remaining rows, exit cleanly |
| 3 publish failures in 1h | Auto-write PAUSED, halt batch |

### Layer 4 — Browser anti-detection

| Measure | Value |
|---|---|
| Browser binary | Playwright's bundled Chromium (Chrome for Testing) |
| `navigator.webdriver` | False (verified via DOM probe) |
| Args | `--disable-blink-features=AutomationControlled` |
| Profile | Real persistent context at `~/.linkedin-commenter/chrome-profile/` |
| Cookies | Survive across runs (`li_at` cookie ~1 year TTL) |
| Viewport | 1440x900 (real laptop screen size) |
| Mode | Headed only — never headless (LinkedIn fingerprints headless) |
| Scroll | 200-600px steps, 1.5-4s pauses, 15% chance of back-scroll |
| Typing | 35-90ms per keystroke, 4% chance of mid-word pause (300-700ms), no paste |
| Mouse clicks | ±3px jitter around target coordinate |

### Detection signal handling

Triggers that halt operations + write PAUSED flag + screenshot to `~/Downloads/`:

- Restriction banner detected on `/feed/` (8 signal phrases scanned)
- Redirect to `/checkpoint/` or `/uas/login` after action
- Captcha / verify-identity modal
- Comment editor not found after Comment-trigger click
- Submit button not found or stays disabled after typing
- Submit redirect (URL changed to checkpoint/login)
- Editor still contains the comment text after submit (publish silently failed)

---

## Voice (your own, generated)

The model voice lives in **one file**: `src/ai/voice-profile.md`. It is loaded as the system prompt for every `claude -p` call.

It is **per-user and gitignored** — you generate your own copy by running:

```bash
npm run voice:init
```

The wizard asks ~15 questions across four areas:

| Area | What it captures |
|---|---|
| Identity | Name, role, company, one-line bio |
| Voice register | Adjectives, default casing, swearing frequency, sarcasm level, tonal inspirations |
| Substance | Topics, your unique angle, 1-3 writing samples (the most important signal), 3 things you find annoying about typical LinkedIn comments |
| Goals | Why you're commenting, who you want to attract |

It then sends your answers to `claude -p` with a meta-prompt that fills in [`src/ai/voice-profile.template.md`](src/ai/voice-profile.template.md) — which is the structural skeleton holding the universal LinkedIn anti-cope rules verbatim while letting Claude personalize the parts that actually depend on you (tone patterns, examples, cadence description).

Your answers persist at `~/.linkedin-commenter/voice-answers.json`, so re-running the wizard preloads them as defaults — quick iteration loop until the output sounds like you.

```bash
npm run voice:init     # interactive wizard → writes src/ai/voice-profile.md
npm run voice          # open the resulting file in $EDITOR for hand-tweaking
npm run draft:test -- "<paste a real LinkedIn post>"   # sanity check
```

### What the generated profile contains

- **Tone patterns** — synthesized from your writing samples + adjectives (specific phrases / structures, not generic "be authentic" platitudes)
- **Personalized examples** — 4 worked OP-claim → comment pairs in your voice
- **Universal rejections (verbatim)** — em/en dash ban, antithesis structure ban, banned curiosity openers, corporate sludge, LinkedIn-bro patterns
- **Hard constraints (verbatim)** — 1-3 sentences, 280 char cap, English only, no emoji, no hashtags, no `!`

### Adding a banned phrase later

Edit `src/ai/voice-profile.md` (tells the model not to use it) **and** `src/ai/guardrails.ts` (rejects the output even if the model slips). Belt and suspenders.

```ts
// src/ai/guardrails.ts
export const BANNED_PHRASES_ANYWHERE = [
  'curious',
  'leverage',
  'synergy',
  // ...add yours here
];
```

---

## Account safety

Daily volume caps with phased ramp. The `seen_posts` table and 14-day same-author cooldown prevent the patterns that LinkedIn's anti-spam actually penalizes — duplicate text, mass action on the same target, machine-regular intervals.

| Phase | Days since first run | Daily cap | Gap between publishes |
|---|---|---|---|
| Ramp | 1-3 | 5 | 45-120s |
| Build | 4-7 | 10 | 30-90s |
| Steady | 8+ | 15 | 30-90s |

**Why these timings:** real engaged users comment 5-10 times in a 10-15 min reading session. The earlier 6-15 min cooldowns made the pattern look mechanical (always a long, regular gap). The new range mimics natural feed-engagement bursts. Daily cap is the actual safety lever.

### Kill switches

Any one of these halts both `scan` and `publish`:

```bash
# 1. Environment variable
LINKEDIN_PAUSE=1 npm run publish

# 2. File flag (persists across runs)
touch ~/.linkedin-commenter/PAUSED

# 3. Automatic — written when 3 publishes fail in any 1-hour window,
#    or when restriction language is detected on /feed/
```

To resume after a manual investigation: `rm ~/.linkedin-commenter/PAUSED`.

---

## Failure modes & recovery

| Symptom | What you'll see | Recovery |
|---|---|---|
| Not logged into Chrome profile | `Scraped 0 posts. Check ~/Downloads/...png` | Run `npm run setup`, log into LinkedIn in the Playwright Chrome window, close it |
| LinkedIn shipped new selectors | `(N posts skipped — no URN extractable)` | Open `src/linkedin/feed-scraper.ts`, update selectors against latest DOM |
| Submit button stays disabled | `✗ Failed: submit button not found or still disabled after typing` | Likely typing didn't hit the editor — inspect screenshot at `~/Downloads/linkedin-incident-no-submit-button-*.png` |
| Notion 404 on data source | `Could not find database with ID: <ds_id>` | In Notion, share the DB with your integration via DB → "..." → Connections |
| Restriction banner detected | `ACCOUNT PAUSED: <signal>` + exit code 2 | Open the screenshot, log into LinkedIn manually, address the verification, then `rm ~/.linkedin-commenter/PAUSED` |
| Claude usage limit hit | `Usage limit hit. Stopping.` | Wait for subscription quota reset, retry |
| 3 consecutive publish failures | Auto-PAUSED with reason in flag file | Read flag (`cat ~/.linkedin-commenter/PAUSED`), inspect screenshots, address root cause, delete flag |
| Same comment doubled in editor | Pre-clearing draft before typing should prevent this | If it happens, `Meta+A → Delete` is added before each type — verify in commenter.ts |

All Playwright incidents save a full-page screenshot to `~/Downloads/linkedin-incident-<reason>-<timestamp>.png` for post-mortem.

---

## Notion DB schema

Pre-create the DB in your workspace; share it with an integration; put `NOTION_TOKEN` and `NOTION_DB_ID` in `.env`.

| Field | Type | Used for |
|---|---|---|
| Name | title | "<author> — <40 chars>" preview |
| post_url | url | Canonical LinkedIn post URL (constructed from decoded URN) |
| author | rich_text | Post author |
| post_text | rich_text | Original post body |
| screenshot | files | Optional post screenshot |
| draft | rich_text | Auto-generated comment |
| final_text | rich_text | Optional — your edits land here. If blank, `draft` is published |
| status | select | `pending → approved → publishing → published / failed / skipped / deferred` |
| reason | rich_text | Filled by the tool on skip/fail/defer |
| scanned_at | date | When the drafter ran |
| published_at | date | When the comment went live |

After successful publish: status flips to `published`, then the row is auto-archived (hidden from default views, recoverable for 30 days via Notion's restore).

---

## Setup

One-time, ~10 minutes including the voice wizard.

### 1. Install dependencies

```bash
git clone https://github.com/<you>/linkedin-commenter && cd linkedin-commenter
npm install
npx playwright install chromium
```

You also need the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) on your `PATH` (the worker shells out to `claude -p` for drafting). Install:

```bash
npm install -g @anthropic-ai/claude-code
claude --version    # confirm it works
```

### 2. Create your Notion queue

Build a Notion DB with these **exact field names + types** (typos cause `object_not_found`):

| Field | Type |
|---|---|
| `Name` | Title |
| `post_url` | URL |
| `author` | Text |
| `post_text` | Text |
| `screenshot` | Files |
| `draft` | Text |
| `final_text` | Text |
| `status` | Select (options: `pending`, `approved`, `publishing`, `published`, `failed`, `skipped`, `deferred`) |
| `reason` | Text |
| `scanned_at` | Date |
| `published_at` | Date |

Then **share the DB with a Notion integration**:
- Create one at https://www.notion.so/profile/integrations → copy the secret (this is `NOTION_TOKEN`)
- Open your DB → `...` menu → **Connections** → add the integration
- Copy the 32-char ID from the DB URL (`https://www.notion.so/<DB_ID>?v=...`) → that's `NOTION_DB_ID`

```bash
cp .env.example .env
# fill NOTION_TOKEN and NOTION_DB_ID
```

### 3. Generate your voice profile

```bash
npm run voice:init
```

15 questions, ~5 minutes if you already know your voice and have a sample to paste. The wizard then shells to `claude -p` and writes `src/ai/voice-profile.md`. Skim the result — if any tone pattern or example feels wrong, either edit the file directly (`npm run voice`) or re-run the wizard (your previous answers preload as defaults).

### 4. Bootstrap the Chrome profile

```bash
npm run setup
```

This re-verifies Notion + Claude CLI + voice profile, then opens a Playwright Chrome window. Log into LinkedIn there manually, then close the window. Cookies persist across runs at `~/.linkedin-commenter/chrome-profile/`.

### 5. Sanity-check the voice

```bash
npm run draft:test -- "<paste a real LinkedIn post>"
```

Prints a draft. Iterate on `src/ai/voice-profile.md` (or re-run `voice:init`) until output sounds like you.

### 6. First dry run

```bash
DRY_RUN=1 npm run scan       # writes nothing to Notion, prints would-be drafts
DRY_RUN=1 npm run publish    # logs would-be publishes, no LinkedIn navigation
```

### 7. Go live

```bash
npm run scan
# approve drafts in Notion
npm run publish
```

The phase ramp starts at 5 publishes/day and grows to 15 over ~7 days. See [Account safety](#account-safety) for cap details.

---

## Project layout

```
linkedin-commenter/
├── assets/demo.gif
├── src/
│   ├── scan.ts                          # entrypoint: scrape + batch-draft + queue
│   ├── publish.ts                       # entrypoint: read approved + like + publish + archive
│   ├── status.ts                        # entrypoint: counts + paused state
│   ├── setup.ts                         # entrypoint: verifies Notion / claude CLI / voice / Chrome
│   ├── voice-init.ts                    # entrypoint: 15-question voice wizard → voice-profile.md
│   ├── draft-test.ts                    # offline drafter sanity test
│   ├── config.ts                        # env, paths, phase calc, cooldown config
│   ├── ai/
│   │   ├── drafter.ts                   # batched `claude -p` shell-out with JSON output
│   │   ├── guardrails.ts                # length, banned phrases, em-dash, antithesis, opener-match
│   │   ├── language.ts                  # English detector (Latin-script + stopword check)
│   │   ├── voice-profile.template.md    # committed: skeleton + verbatim universal rules
│   │   └── voice-profile.md             # gitignored: YOUR generated voice (per-user)
│   ├── linkedin/
│   │   ├── browser.ts                   # Playwright launchPersistentContext + human delays
│   │   ├── feed-scraper.ts              # scroll feed, protobuf URN decoder, extract posts
│   │   ├── commenter.ts                 # like + clear-draft + type + submit, verify clear
│   │   └── safety-check.ts              # restriction detection, paused-flag mgmt
│   ├── notion/
│   │   ├── client.ts                    # @notionhq/client wrapper
│   │   └── queue.ts                     # createPending, listApproved, listOpenAuthors, archivePage
│   ├── cache/sqlite.ts                  # ~/.linkedin-commenter/state.db (dedupe, counters, history)
│   └── tools/                           # one-off utilities (list-pending, scrub-X, reset-failed, etc.)
├── .env / .env.example                  # NOTION_TOKEN, NOTION_DB_ID
├── .gitignore                           # node_modules, .env, chrome-profile, voice-profile.md, ...
├── package.json
└── tsconfig.json
```

### What's gitignored vs committed

| Path | Status | Why |
|---|---|---|
| `.env` | gitignored | Holds your Notion token + DB ID |
| `src/ai/voice-profile.md` | **gitignored** | Personal — generated by `voice:init`, contains your name/role/samples |
| `src/ai/voice-profile.template.md` | committed | Template + verbatim universal rules; same for everyone |
| `chrome-profile/` | gitignored | LinkedIn cookies, persistent browser state |
| `state.db` | gitignored | SQLite cache: dedup, daily counter, recent comments |
| `~/.linkedin-commenter/voice-answers.json` | outside repo | Your wizard answers (so you can re-run + iterate) |
| `~/.linkedin-commenter/PAUSED` | outside repo | Kill-switch flag |

## Stack

- **Node 20+**, TypeScript (ESM, run via `tsx`)
- **Playwright** (Chromium persistent context, headed)
- **`@notionhq/client`** — worker uses direct API; the Claude app uses Notion MCP for approval
- **`better-sqlite3`** — local cache for dedupe, daily counters, recent-comment history
- **`claude` CLI** for drafting — uses your Claude subscription (no Anthropic API key required)

## Out of scope

Daemon mode. Auto-publish. Cloud hosting. Replying to comments on your own posts. DM outreach. Sales Nav / hashtag sourcing. Headless mode. All deliberately not built — every one of these would either (a) cost you account safety or (b) defeat the whole point of manual approval.

---

## Optional skill wrapper

If you use [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) and want to trigger the worker via slash-command instead of `npm run`, you can install a thin skill wrapper that does exactly that.

The skill is **not bundled with this repo** because it lives outside the project (`~/.claude/skills/`) and is per-machine. Below is a minimal `SKILL.md` you can drop in yourself.

```bash
mkdir -p ~/.claude/skills/linkedin-comment
$EDITOR ~/.claude/skills/linkedin-comment/SKILL.md
```

Paste this in (replace `<path-to-repo>` with where you cloned this project, and `<your_db_id>` with your Notion DB ID for the approval URL):

```markdown
# /linkedin-comment

Thin wrapper over the linkedin-commenter project at <path-to-repo>.

## Args

Parse the first word of the user's input as the subcommand:

- `run` (or no arg) → scan + draft + queue to Notion
- `post` → publish whatever you approved in Notion
- `status` → counts, today's published, paused state
- `setup` → first-time install: verify Notion, claude CLI, log into LinkedIn

## Execution

| Arg | Command |
|---|---|
| `run` (default) | `cd <path-to-repo> && npm run scan` |
| `post` | `cd <path-to-repo> && npm run publish` |
| `status` | `cd <path-to-repo> && npm run status` |
| `setup` | `cd <path-to-repo> && npm run setup` |

Stream output. Use a 10-minute timeout for `run` and `post`.

## After completion

Summarize in 3-5 lines:
- For `run`: scraped/queued/skipped counts + Notion DB URL (https://www.notion.so/<your_db_id>) for review
- For `post`: published/failed/deferred counts. If any `failed` or `deferred`, surface why
- For `status`: phase, today's count vs cap, paused state, queue counts

## Critical: account safety signals

If output contains `ACCOUNT PAUSED`, `RESTRICTION`, `CAPTCHA`, `LOGIN_REQUIRED`, or exit code 2:
- DO NOT retry. Halt.
- Tell the user: "LinkedIn account safety check failed. Open `~/Downloads/linkedin-incident-*.png` to see the modal. After confirming the account is healthy, delete `~/.linkedin-commenter/PAUSED` to resume."
- Do not run further LinkedIn-touching commands until explicitly resumed.
```

After saving, the skill becomes available to Claude Code as `/linkedin-comment run|post|status|setup`. Restart Claude Code if it doesn't show up immediately.
