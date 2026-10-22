# iternal-site — agent briefing

This repo is Iternal's live company site (iternal.co.uk) **plus** the
website-build client funnel and its backend worker. Read this, then
`HOUSEKEEPING.md` (operational couplings and the go-live runbook) before
changing anything.

## The pipeline, as built (30 Sep 2026)

Sign up → review and accept the Website Build and Care Terms → questions →
book the call → call → design and build → live. **Accepting forms the
agreement** (13 Oct 2026). **Booking the call takes the downpayment**: the
Google Calendar booking page charges it through Iternal's Stripe account, so a
booking stands only once it is paid (restored 22 Oct 2026). The final payment
is completely separate and outside this project. Before
the call, an agent session builds one concept homepage from the client's
answers.

- `websites.html` — the gallery, sole funnel entrance (curated; consent
  required per HOUSEKEEPING.md). Eight sites; each opens in a lightbox and
  carries a "Start yours" button that tags the sign-up with that site.
- `start.html` — sign-up (4 fields, posted straight to the worker), then
  "Review and accept", filled from the order the worker sends back: the
  order details table, the terms (view or download), two required ticks
  and "Accept and continue", which posts to `/accept` and goes on to the
  questions only once the worker has recorded it. That screen's wording
  was supplied with the terms: keep it word for word.
- `terms/website-build-and-care-v<version>.html` + `.pdf` — the terms the
  client accepts, as supplied, never edited. A new version is a new pair
  of files (the PDF is printed from the page by `tools/terms-pdf.mjs`),
  `TERMS` in `worker/worker.js`, and the terms link in start.html's hero.
- `questions.html` — "Before you book your call": 5 essentials unlock the
  booking, 12 optional. What sign-up already collected is not asked again
  (the email always, the website if they gave one; both still go with the
  answers), so most clients see three or four essentials. Answers are saved to the worker as they go (when
  the page is hidden or closed), so the team can follow up anyone who stops;
  the page says so.
  Identity = the email they type. Booking button → a plain Google Calendar
  appointment schedule.
- `worker/` — the only backend (`client-site-funnel` at
  https://api.iternal.co.uk): `/signup`, `/accept`, `/answers`, `/health`. Every
  sign-up goes to TWO destinations: the Website Build Platform repo (full
  record, answers included) and the Lead Tracker (a summary; never answers).
  It takes no card details; it records the booking payments Stripe reports to
  `/stripe-webhook` (restored 22 Oct 2026). Deploy from
  `worker/`: `node test-worker.js` MUST pass, then `npx wrangler deploy`.
- `../website-build-platform/` — a separate repo: the information & demo
  build dashboard. The worker commits `clients/<slug>.json` there; the
  `website-demo-build` skill drains its `demoRequested` queue. Its own
  CLAUDE.md and README hold the data contract.
- Pricing comes from the order the team set, never from the terms: since 20
  Oct 2026 the order states a £100 downpayment + £650 upon completion,
  including VAT; care plan £50 a month including VAT from the month after the
  site goes live, which includes Site Agent (our agentic studio) for the
  client's own updates. **The terms file (version 1.0, 13 Oct 2026) is
  invalid** (Robbie, 20-21 Oct 2026): it stays in the preview sign-up only
  until the real terms are supplied, and no fact, figure, name or promise is
  ever taken from it, in copy or in reviews. Pages never add a figure,
  promise or refund the team has not set. Every place a figure is printed is
  listed in HOUSEKEEPING.md §Payment.
- Do not promise a number of concepts ("two or three") anywhere on these
  pages. We show them; we do not announce them.
- `SITE-CHANGES.md` is the running log of what a visitor would notice, in
  plain English, page by page. Every visible change adds a line there in the
  same commit, under "Waiting to deploy"; after a deploy, move those lines to
  "Live" under the date and update the version line at the top. It is in
  `.assetsignore`, so it is never published.
- Clients get one email from us: on accepting, a copy of their order and
  the terms (PDF attached), as the terms promise, from
  "Iternal <websites@iternal.co.uk>" with replies to john@iternal.life
  (`CLIENT_MAIL`, Cloudflare Email Service). If it cannot send, the team
  gets it to forward. Google Calendar sends the invite. Team briefs go to
  john@iternal.life (the one address since 20 Oct 2026) as
  "Website Pipeline <funnel@iternal.co.uk>" (`TEAM_MAIL`).

## Currently DISABLED / dark (deliberate — do not "fix")

- **Dark launch**: no public page on main links to the funnel. The Websites
  entry on Services and the homepage row are in the pages but `hidden`, and
  the contact form has no Websites option (HOUSEKEEPING.md §Go-live step 1).
  websites.html and
  start.html are `noindex`; sitemap never lists them. Lighting up = the
  checklist in HOUSEKEEPING.md §Go-live, done on main on the day.
- **Preview** (`preview.js`, on start.html and questions.html): every
  screen can be stepped through, empty fields included, but nothing is
  sent and no call is booked; a gold banner says "Sign-ups and call
  bookings aren't live yet." `?team` switches to the real sign-up for the
  browser tab (`?team=off` switches back). Removed at light-up.
- **The pipeline feed** is off until `PIPELINE_TOKEN` is set on the worker.
- `privacy.html` exists but is deliberately unlinked pending legal review.

## Third parties — what we feed them, what comes back

| Party | We send | Comes back | Rules |
|---|---|---|---|
| **Worker /signup, /answers** (ours) | sign-up fields and answers, from the pages | `{ok}` | The page shows success only once the worker has it |
| **GitHub** (platform repo) | one `clients/<slug>.json` per client: identity and answers (never payment) | file sha, used for the next write | Personal data in a private repo. Token scoped to that one repo. Named as a processor in the privacy draft |
| **Lead Tracker** (Apps Script, separate `lead-tracker` repo) | `createLead` POSTs on sign-up and on accepting the terms (with `event`), secret-gated (`LEAD_API_SECRET`) | `{ok, id}` and NOTHING else | **WRITE-ONLY. Never read tracker/Sheet data — it is private.** Dedupes by email: repeat posts become notes on the existing record. Never sent answers |
| **Google Calendar** | the client (we just link to the appointment schedule URL) | nothing to our systems — the invite goes to the client | The schedule lives in Google's UI, not in code. It requires payment through Iternal's Stripe account: no payment, no booking |
| **Stripe** (through the booking page) | nothing: the client pays on Google's booking page | `payment_intent.succeeded` / `checkout.session.completed` to `/stripe-webhook`, signed with `STRIPE_WEBHOOK_SECRET` | Only a payment of the booking amount (the downpayment) concerns the funnel; every other payment on the account is ignored. Matched to the sign-up by email, recorded once in KV, briefed to the team and noted in the tracker; never sent to the platform repo. A booking payment that matches no sign-up still emails the team |
| **Cloudflare Email Routing** | team briefs | — | Every recipient must be a verified destination |
| **Cloudflare Email Service** | the client's copy of their order and terms | message id | Sends from iternal.co.uk once it is onboarded as a sending domain (Workers Paid). A failure emails the team the copy to forward |
| **Slack** | nothing directly — pings come from the Lead Tracker | — | |
| **GitHub Action** (`.github/workflows/screenshots.yml`) | weekly gallery screenshot refresh commits | — | Gallery additions touch FOUR places — see HOUSEKEEPING.md |

FormSubmit is no longer in the sign-up path. It remains only as an unused
fallback constant in questions.html.

## Current to-do (30 Sep 2026)

1. Create the private GitHub repo for `../website-build-platform`, push it,
   and set the worker's `PIPELINE_TOKEN`.
2. Verify john@iternal.life as an Email Routing destination (since 20 Oct
   2026 it receives the briefs and clients' replies; websites@iternal.life
   can follow), then deploy the worker.
3. Deploy the site (held: only on Robbie's word, named in that moment).
4. `?team` walkthrough: one real sign-up should yield a client file, a
   tracker row and both briefs.
5. Payment: the £100 downpayment is taken when the client books their call
   (hello@iternal.life's Google Calendar + Stripe, restored 22 Oct 2026); the
   final payment is separate, outside this project. Setup steps:
   HOUSEKEEPING.md §Payment.
6. Show the team the current front end — they have not seen the gallery,
   lightbox or question changes. They want the prospect experience to take
   its cue from the sleekness of existing sites; redesign after they have
   seen what exists.
7. Legal: the Website Build and Care Terms, supplied 13 Oct 2026 and
   accepted online at the end of sign-up (they replace the earlier plan of
   a contract signed after the call). No separate privacy and legal
   review; agents never draft, edit or decide terms, and place supplied
   wording word for word.
8. bplaced-site production deploy (`npx wrangler pages deploy --branch
   main` from that repo) so its gallery card opens in the lightbox.
9. Stale artefacts: the StateCraft diagram
   (`../statecraft/diagrams/client-funnel.scd`) and
   `../build-a-site-journey.html` both predate this design.

## Rules and gotchas for agents

- **Never deploy or push to production on your own** — only on Robbie's
  explicit per-request instruction, and a site deploy only when he names it
  in that moment.
- The live site is Workers **static assets only** (root `wrangler.toml`,
  filtered by `.assetsignore` — keep this file, HOUSEKEEPING.md, worker/,
  tools/ and .git out of uploads). **Pushing to main deploys the site**
  (Cloudflare builds from GitHub within about a minute; confirmed 20 Oct
  2026), so a push to main needs the same word from Robbie as a deploy. A
  manual `npx wrangler deploy` ships the whole local working tree,
  including uncommitted and untracked files: check `git status` first.
- `_headers` sets the security and asset-cache headers (Workers parses it; it
  is never served, so keep it out of `.assetsignore`). Its CSP is
  report-only: add any new third-party origin there before enforcing it.
  Internal links use clean URLs (`/about`), which the `iternal-site` launch
  config serves through `wrangler dev`, as production does; a plain static
  server would 404 them.
- Question wording is COUPLED to `worker/worker.js`'s QUESTIONS map;
  gallery entries are coupled across four places (incl. the worker's
  GALLERY_SITES slug map behind the per-site "Start yours" buttons) —
  HOUSEKEEPING.md has both checklists.
- Copy register: professional but human. No slang, no stiff formality.
  Gallery captions describe the site as a product, never the engagement.
- Windows/bash gotcha: writing `\n`/`\r`/`\u` escapes through a bash
  heredoc into python/node collapses them — use the Write/Edit tools for
  such code.
- The Lead Tracker app lives in the separate `lead-tracker` repo
  (IternalEngineering/SiteManagement); its public deployment redeploy has
  a manifest-access dance documented in that repo's memory. Its data is
  private: diagnose via code, never by reading records.
- The company is "Iternal Ltd" (legal entity history: formerly Deathio Ltd —
  don't resurrect the old name anywhere).
