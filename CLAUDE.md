# iternal-site — agent briefing

This repo is Iternal's live company site (iternal.co.uk) **plus** the
website-build client funnel and its backend worker. Read this, then
`HOUSEKEEPING.md` (operational couplings and the go-live runbook) before
changing anything.

## The pipeline, as built (30 Sep 2026)

Sign up → agree the terms → questions → book the call → call → 2–3 concepts
→ build → live. **Booking takes no payment**; the deposit is requested
separately by the team. Before the call, an agent session builds one concept
homepage from the client's answers.

- `websites.html` — the gallery, sole funnel entrance (curated; consent
  required per HOUSEKEEPING.md). Eight sites; each opens in a lightbox and
  carries a "Start yours" button that tags the sign-up with that site.
- `start.html` — sign-up (4 fields, posted straight to the worker) +
  engagement terms + required agreement checkbox that unlocks "Continue to
  Your Questions". The agreed-at timestamp travels via sessionStorage into
  the answers as `termsAgreed`.
- `questions.html` — "Before you book your call": 5 essentials unlock the
  booking, 12 optional. Drafts in sessionStorage only, wiped on send.
  Identity = the email they type. Booking button → a plain Google Calendar
  appointment schedule.
- `worker/` — the only backend (`client-site-funnel` at
  https://api.iternal.co.uk): `/signup`, `/answers`, `/stripe-webhook`,
  `/health`. Every sign-up and answer goes to TWO destinations: the
  Website Build Platform repo (full record, no payment) and the Lead
  Tracker (summary; payments go there too, never to the platform). Deploy from
  `worker/`: `node test-worker.js` MUST pass, then `npx wrangler deploy`.
- `../website-build-platform/` — a separate repo: the information & demo
  build dashboard. The worker commits `clients/<slug>.json` there; the
  `website-demo-build` skill drains its `demoRequested` queue. Its own
  CLAUDE.md and README hold the data contract.
- Pricing language: £750 all in, a deposit to get started, the balance at
  launch. The deposit FIGURE is undecided (£100 or 30% under discussion) —
  do not print one until Robbie gives it. Never say payment is taken at
  booking.
- Clients get no email from us: Google Calendar sends the invite. Team
  briefs go to websites@iternal.life and john@iternal.life as
  "Website Pipeline <funnel@iternal.co.uk>" via the worker's send_email
  binding.

## Currently DISABLED / dark (deliberate — do not "fix")

- **Dark launch**: no public page links to the funnel; websites.html and
  start.html are `noindex`; sitemap never lists them. Light-up = the
  revert steps in HOUSEKEEPING.md §Go-live.
- **Preview gate** on start.html: sign-up is disabled and a gold
  "In testing" banner shows unless `?team` is on the URL. Removed at
  light-up.
- **The pipeline feed** is off until `PIPELINE_TOKEN` is set on the worker.
- `privacy.html` exists but is deliberately unlinked pending legal review.
- The Stripe webhook is wired but nothing in the funnel takes payment.

## Third parties — what we feed them, what comes back

| Party | We send | Comes back | Rules |
|---|---|---|---|
| **Worker /signup, /answers** (ours) | sign-up fields and answers, from the pages | `{ok}` | The page shows success only once the worker has it |
| **GitHub** (platform repo) | one `clients/<slug>.json` per client: identity and answers (never payment) | file sha, used for the next write | Personal data in a private repo. Token scoped to that one repo. Named as a processor in the privacy draft |
| **Lead Tracker** (Apps Script, separate `lead-tracker` repo) | `createLead` POSTs on sign-up and on payment, secret-gated (`LEAD_API_SECRET`) | `{ok, id}` and NOTHING else | **WRITE-ONLY. Never read tracker/Sheet data — it is private.** Dedupes by email: repeat posts become notes on the existing record |
| **Stripe** | nothing outbound from our code | webhook events to `/stripe-webhook`, HMAC-verified (`STRIPE_WEBHOOK_SECRET`, live) | Only fires if the team requests a deposit through Stripe; matches payer by email; email-less payments brief the team as UNMATCHED |
| **Google Calendar** | the client (we just link to the appointment schedule URL) | nothing to our systems — the invite goes to the client | The schedule lives in Google's UI, not in code. No payment step |
| **Cloudflare Email Routing** | team briefs | — | Every recipient must be a verified destination |
| **Slack** | nothing directly — pings come from the Lead Tracker | — | |
| **GitHub Action** (`.github/workflows/screenshots.yml`) | weekly gallery screenshot refresh commits | — | Gallery additions touch FOUR places — see HOUSEKEEPING.md |

FormSubmit is no longer in the sign-up path. It remains only as an unused
fallback constant in questions.html.

## Current to-do (30 Sep 2026)

1. Create the private GitHub repo for `../website-build-platform`, push it,
   and set the worker's `PIPELINE_TOKEN`.
2. Create websites@iternal.life; verify it and john@iternal.life as Email
   Routing destinations; then deploy the worker.
3. Deploy the site (held: only on Robbie's word, named in that moment).
4. `?team` walkthrough: one real sign-up should yield a client file, a
   tracker row and both briefs.
5. Decide the deposit figure and how it is requested; put the figure in
   the pages.
6. Show the team the current front end — they have not seen the gallery,
   lightbox or question changes. They want the prospect experience to take
   its cue from the sleekness of existing sites; redesign after they have
   seen what exists.
7. Legal: privacy.html review + linking (now naming GitHub, not
   FormSubmit); terms small-print; ICO data-protection-fee check
   (`../legal-review-pack.md`).
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
  tools/ and .git out of uploads). A deploy ships the whole working tree,
  including uncommitted and untracked files: check `git status` first.
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
  (IternalEngineering/LeadManagement); its public deployment redeploy has
  a manifest-access dance documented in that repo's memory. Its data is
  private: diagnose via code, never by reading records.
- The Stripe brand name is "Iternal Ltd" (legal entity history: formerly
  Deathio Ltd — don't resurrect the old name anywhere).
