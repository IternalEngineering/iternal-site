# iternal-site — agent briefing

This repo is Iternal's live company site (iternal.co.uk) **plus** the
website-build client funnel and its backend worker. Read this, then
`HOUSEKEEPING.md` (operational couplings and the go-live runbook) before
changing anything.

## The pipeline, as built (30 Sep 2026)

Sign up → review and accept the Website Build and Care Terms → pay the
downpayment on Stripe → questions → book the call → call → design and build →
live. **Accepting forms the agreement** (13 Oct 2026) and **goes straight to
the downpayment** on a Stripe Checkout page made for the order (the team's
client journey, 22 Oct 2026); the booking takes no payment. The final payment
is completely separate and outside this project. The pre-call concept
homepage is outside the automation: the team decides whether to build one
(the worker only flags the client on the dashboard).

- `websites.html` — the gallery, sole funnel entrance (curated; consent
  required per HOUSEKEEPING.md). Eight sites; each opens in a lightbox and
  carries a "Start yours" button that tags the sign-up with that site.
- `start.html` — sign-up (4 fields, posted straight to the worker), then
  "Review and accept", filled from the order the worker sends back: the
  order summary, the nine key points of the terms, "Read the full terms"
  (a pop-up with the PDF), two required ticks and "Accept and pay £100",
  which posts to `/accept` and, once the worker has recorded it (with the
  IP address it came from), goes to the client's Stripe payment page; paid,
  Stripe returns them to the questions. That screen's wording is the team's
  sign-up walkthrough, supplied with the terms: keep it word for word.
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
  Identity = the email they type. The page opens only once the worker has
  the client's payment (`/status`); until then it says which step is
  missing. Booking button → a plain Google Calendar appointment schedule,
  whose link comes from the worker then (never in the page). The steps run
  in order (Robbie, 27 Oct 2026).
- `worker/` — the only backend (`client-site-funnel` at
  https://api.iternal.co.uk): `/signup`, `/accept`, `/status`, `/answers`, `/health`. Every
  sign-up goes to TWO destinations: the Website Build Platform repo (full
  record, answers included) and the Lead Tracker (a summary; never answers).
  It takes no card details: it asks Stripe for each client's payment page
  and records the payments Stripe reports to `/stripe-webhook`. Deploy from
  `worker/`: `node test-worker.js` MUST pass, then `npx wrangler deploy`.
- `../website-build-platform/` — a separate repo: the information & demo
  build dashboard. The worker commits `clients/<slug>.json` there; the
  `website-demo-build` skill drains its `demoRequested` queue. Its own
  CLAUDE.md and README hold the data contract.
- Pricing comes from the order the team set, never from the terms: since 20
  Oct 2026 the order states a £100 downpayment + £650 upon completion,
  including VAT; care plan £50 a month including VAT from the month after the
  site goes live, which includes Site Agent (our agentic studio) for the
  client's own updates. **The terms are the Iternal Website Build and Care
  Terms, version 1.0**, supplied 22 Oct 2026 and confirmed final by Robbie
  on 27 Oct 2026 (the first public version; it replaced an earlier, invalid
  draft of the same number that was never public), effective 27 October
  2026 (Robbie). Pages never add a figure, promise
  or refund the team has not set. Every place a figure is printed is listed
  in HOUSEKEEPING.md §Payment.
- Do not promise a number of concepts ("two or three") anywhere on these
  pages. We show them; we do not announce them.
- `SITE-CHANGES.md` is the running log of what a visitor would notice, in
  plain English, page by page. Every visible change adds a line there in the
  same commit, under "Waiting to deploy"; after a deploy, move those lines to
  "Live" under the date and update the version line at the top. It is in
  `.assetsignore`, so it is never published.
- Clients get one email from us: once they have paid, their confirmation
  (the order, the booking link, the terms PDF attached), worded as the
  team's sign-up example, from
  "Iternal <websites@iternal.co.uk>" with replies to john@iternal.life
  (`CLIENT_MAIL`, Cloudflare Email Service). If it cannot send, the team
  gets it to forward. Stripe sends the receipt and VAT invoice, Google
  Calendar the invite. Team briefs go to
  john@iternal.life (Robbie, 27 Oct 2026: John's schedule takes the calls, so
  the launch uses his address; the terms still name hello@iternal.life for
  notices) as
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
| **Lead Tracker** (Apps Script, separate `lead-tracker` repo) | `createLead` POSTs on sign-up, on accepting the terms and on payment (with `event`; the record is "Awaiting downpayment" until `paid`), secret-gated (`LEAD_API_SECRET`) | `{ok, id}` and NOTHING else | **WRITE-ONLY. Never read tracker/Sheet data — it is private.** Dedupes by email: repeat posts become notes on the existing record. Never sent answers |
| **Google Calendar** | the client (we just link to the appointment schedule URL) | nothing to our systems — the invite goes to the client | The schedule lives in Google's UI, not in code. It takes no payment: the client has paid already |
| **Stripe** (Checkout) | on accepting, a Checkout Session per visit: the dashboard's Price and VAT rate, the client's email and reference, `metadata.funnel = website-build` (restricted `STRIPE_API_KEY`: Checkout Sessions write only) | the payment page's URL; then `checkout.session.completed` to `/stripe-webhook`, signed with `STRIPE_WEBHOOK_SECRET` | Only our own paid pages concern the funnel; every other payment on the account is ignored. Matched to the order by reference, recorded once in KV, confirmed to the client, briefed to the team and noted in the tracker; never sent to the platform repo. A payment for an order already paid, or with no record, still emails the team |
| **Cloudflare Email Routing** | team briefs | — | Every recipient must be a verified destination |
| **Cloudflare Email Service** | the client's confirmation once they have paid, with the terms attached | message id | Sends from iternal.co.uk once it is onboarded as a sending domain (Workers Paid). A failure emails the team the text to forward |
| **Slack** | nothing directly — pings come from the Lead Tracker | — | |
| **GitHub Action** (`.github/workflows/screenshots.yml`) | weekly gallery screenshot refresh commits | — | Gallery additions touch FOUR places — see HOUSEKEEPING.md |

FormSubmit is no longer in the sign-up path. It remains only as an unused
fallback constant in questions.html.

## Current to-do (30 Sep 2026)

1. Create the private GitHub repo for `../website-build-platform`, push it,
   and set the worker's `PIPELINE_TOKEN`.
2. Deploy the worker (john@iternal.life, a verified Email Routing
   destination, receives the briefs and clients' replies).
3. Deploy the site (held: only on Robbie's word, named in that moment).
4. `?team` walkthrough: one real sign-up and acceptance should yield a
   client file, a tracker row and the acceptance brief.
5. Payment: the £100 downpayment is paid on Stripe Checkout straight after
   accepting (the team's client journey, 22 Oct 2026); the final payment is
   separate, outside this project. Setup steps (Price, VAT rate, restricted
   key, webhook event): HOUSEKEEPING.md §Payment.
6. Show the team the current front end — they have not seen the gallery,
   lightbox or question changes. They want the prospect experience to take
   its cue from the sleekness of existing sites; redesign after they have
   seen what exists.
7. Legal: the Iternal Website Build and Care Terms, version 1.0 (final
   27 Oct 2026, effective 27 October 2026), accepted online at the end of
   sign-up. Agents never draft, edit or decide terms,
   and place supplied wording word for word. The one change from the
   supplied text is Robbie's (27 Oct 2026): "web agent" reads "Site Agent"
   (clauses 3 and 10, and the key points).
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
