# iternal-site — agent briefing

This repo is Iternal's live company site (iternal.co.uk) **plus** the
website-build client funnel and its backend worker. Read this, then
`HOUSEKEEPING.md` (operational couplings and the go-live runbook) before
changing anything.

## The pipeline, as built (10 Sep 2026)

Sign up → agree the terms → questions → **book the call, where the £375 is
taken** → call → 2–3 concepts → build → live. Pay-at-booking: payment
happens on the Google Calendar booking page (Google's Stripe integration);
no successful payment, no booking. Our site never touches card details.

- `websites.html` — the gallery, sole funnel entrance (curated; consent
  required per HOUSEKEEPING.md).
- `start.html` — sign-up (4 fields) + engagement terms + required
  agreement checkbox that unlocks "Continue to Your Questions". The
  agreed-at timestamp travels via sessionStorage into the answers as
  `termsAgreed`.
- `questions.html` — "Before you book your call": 5 essentials unlock the
  booking, 12 optional. Drafts in sessionStorage only, wiped on send.
  Identity = the email they type. Booking button → Google Calendar.
- `worker/` — the only backend (`client-site-funnel` at
  https://api.iternal.co.uk): `/signup` (seed lead + tracker post),
  `/answers` (attach answers + Q&A brief), `/stripe-webhook`
  (payment_intent.succeeded = booked & paid; legacy
  checkout.session.completed kept), `/health`. Deploy from `worker/`:
  `node test-worker.js` MUST pass, then `npx wrangler deploy`.
- Pricing language rules: £750 all in as TWO EQUAL £375 payments — the
  first at call booking, the second invoiced at launch. NEVER "50% of
  fees", never a stored-card charge for the second half.
- Clients get exactly two emails, neither from us: Stripe's receipt and
  Google Calendar's invite. Team briefs go to paul@iternal.life as
  "Website Pipeline <funnel@iternal.co.uk>" via the worker's send_email
  binding.

## Currently DISABLED / dark (deliberate — do not "fix")

- **Dark launch**: no public page links to the funnel; websites.html and
  start.html are `noindex`; sitemap never lists them. Light-up = the
  revert steps in HOUSEKEEPING.md §Go-live.
- **Preview gate** on start.html: sign-up is disabled and a gold
  "In testing" banner shows unless `?team` is on the URL. Removed at
  light-up.
- **The payment step is not yet configured**: Google Calendar's
  "require payment when booking" (£375, connected Stripe) is pending
  Robbie's dashboard work — until then booking a call takes no payment.
- The old £375 Stripe Payment Link (buy.stripe.com/eVqfZi…) is
  unreferenced and awaiting deactivation in Stripe.
- `privacy.html` exists but is deliberately unlinked pending legal review.

## Third parties — what we feed them, what comes back

| Party | We send | Comes back | Rules |
|---|---|---|---|
| **FormSubmit** | sign-up form fields (name, email, org, site) → relays as email to paul@iternal.life | JSON ack only | Third-party relay; named in the privacy draft; candidate for replacement by the worker |
| **Worker /signup** (ours) | same sign-up fields, fired after FormSubmit succeeds | `{ok}` | Fire-and-forget from the page; must never block the client |
| **Lead Tracker** (Apps Script, separate `lead-tracker` repo) | `createLead` POSTs: sign-up ("Signed up…") and booked-&-paid ("Booked the call and paid £375…"), secret-gated (`LEAD_API_SECRET`) | `{ok, id}` and NOTHING else | **WRITE-ONLY. Never read tracker/Sheet data — it is private.** The tracker dedupes by email: repeat posts become notes on the existing record |
| **Stripe** | nothing outbound from our code | webhook events to `/stripe-webhook`, HMAC-verified (`STRIPE_WEBHOOK_SECRET`, live). Needs `payment_intent.succeeded` subscribed (dashboard) | Payments are created by Google Calendar's integration, not by us; the worker matches payer by email; email-less payments brief the team as UNMATCHED |
| **Google Calendar** | the client (we just link to the appointment schedule URL) | nothing to our systems directly — the invite goes to the client; the money comes back to us via the Stripe webhook | The appointment schedule + its payment setting live in Google's UI, not in code |
| **Slack** | nothing directly — pings come from the Lead Tracker | — | |
| **GitHub Action** (`.github/workflows/screenshots.yml`) | weekly gallery screenshot refresh commits | — | Gallery additions touch THREE files — see HOUSEKEEPING.md |

## Current to-do (10 Sep 2026)

1. Robbie: deploy the site (`npx wrangler deploy` from repo root — an
   agent CANNOT run this, the permission layer reserves prod deploys for
   the user; prepare everything and hand over the command).
2. Robbie: Google Calendar → appointment schedule → Payments → connect
   Stripe, £375. TIER-DEPENDENT — if the Payments section is absent,
   the fallback is the charge-then-book design in
   `../build-flow-end-to-end.html`'s history.
3. Robbie: Stripe webhook → add `payment_intent.succeeded` event.
4. Robbie: deactivate the old Payment Link.
5. Team: `?team` walkthrough on the dark URLs (a real test booking +
   refund proves the whole chain).
6. Legal: privacy.html review + linking; terms small-print annex; ICO
   data-protection-fee registration check (`../legal-review-pack.md`).
7. Light-up when the team says go (HOUSEKEEPING.md §Go-live).
8. Stale artefacts to refresh after the dust settles: the StateCraft
   diagram (`../statecraft/diagrams/client-funnel.scd`) still shows the
   old payment-link flow; `../build-a-site-journey.html` screenshots
   predate the reflow.

## Rules and gotchas for agents

- **Never deploy or push to production on your own** — only on Robbie's
  explicit per-request instruction. Site deploys are his to run anyway
  (see to-do #1). Worker deploys have been done by agents on instruction.
- The live site is Workers **static assets only** (root `wrangler.toml`,
  filtered by `.assetsignore` — keep this file, HOUSEKEEPING.md, worker/,
  tools/ and .git out of uploads).
- Question wording is COUPLED to `worker/worker.js`'s QUESTIONS map;
  gallery entries are coupled across three files — HOUSEKEEPING.md has
  both checklists.
- Windows/bash gotcha: writing `\n`/`\r`/`\u` escapes through a bash
  heredoc into python/node collapses them — use the Write/Edit tools for
  such code.
- The Lead Tracker app lives in the separate `lead-tracker` repo
  (IternalEngineering/LeadManagement); its public deployment redeploy has
  a manifest-access dance documented in that repo's memory. Its data is
  private: diagnose via code, never by reading records.
- The Stripe checkout brand name is "Iternal Ltd" (legal entity history:
  formerly Deathio Ltd — don't resurrect the old name anywhere).
