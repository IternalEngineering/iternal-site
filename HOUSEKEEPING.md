# Housekeeping — the funnel's moving parts

Couplings and switches that aren't visible from any single file. Update this
when one of them changes.

## Questions ↔ worker briefs

The question wording lives twice:

- `questions.html` — the `QUESTIONS` array the client sees.
- `worker/worker.js` — the `QUESTIONS` id→wording map. It renders the team
  briefs AND is the pipeline repo's question list: every question is written
  to each client record in page order (`answer: null` when skipped), which
  is what lets the dashboard fill in a skipped answer. An answer the team
  has edited there is left alone until the client changes it themselves.

Reword, add, remove or reorder a question → make the matching change in the
worker map and redeploy. If they drift, nothing breaks: an unknown id falls
back to the raw field id (`mainJob: …`) and no answer is ever dropped.

## Adding a site to the gallery

The gallery is curated — a new site going live does NOT automatically earn a
place. Adding one is a deliberate call, made by a person, per site, and only
with the featured client's consent. Additions happen quietly: the page makes
no promise that new sites are coming. Once the call is made, four places move
together:

1. `websites.html` — the gallery entry (label, description, screenshot img,
   and the "Start yours" button whose `start.html?from=<slug>` link tags the
   sign-up with the example that hooked them). The screenshot is wrapped in
   an `<a class="g-view">` to the live site with `data-embed`, which opens
   the click in the lightbox instead of a new tab. That needs the site's
   headers to allow framing: our own builds set `frame-ancestors 'self'`
   plus the four iternal.co.uk / iternal.life origins in their `_headers`
   file (AGF, pawlett-pavilion and bplaced-site got this Sept 2026 — copy
   that pattern, and never ship a plain `X-Frame-Options` on a gallery
   site). A site that blocks framing gets no `data-embed` and falls back to
   a new tab.
2. `worker/worker.js` — the `GALLERY_SITES` slug→name map (the whitelist
   that turns `?from=` into the client record's `inspiration` and the
   tracker note "Came in from the … example"); redeploy the worker after
   changing it.
3. `tools/screenshots.js` — the `SHOTS` list, so the weekly screenshot
   refresh covers it.
4. `questions.html` — the "Are there any websites you like the look of?"
   options, which mirror the gallery.

## Two destinations (30 Sep 2026)

Everything a client enters is sent to two places, independently, by the
worker. One failing never stops the other, and neither can fail the client's
request.

1. **The website-build pipeline repo** (`PIPELINE_REPO` in `wrangler.toml`,
   locally `Iternal/website-build-pipeline`). The worker commits one
   `clients/<slug>.json` per client through the GitHub API: the full record,
   with labelled answers. The information & demo build dashboard shows it
   and agent sessions work from it. The first answers set
   `demoRequested: true`, which queues the pre-call demo build for the
   `website-demo-build` skill. Field ownership is in that repo's README —
   the worker refreshes its own fields and carries everything else over.
2. **The Lead Tracker** — a summary post. Write-only from the funnel (never
   read — the data is private). The worker posts `createLead` to the public
   "Anyone" /exec deployment named in `wrangler.toml`. Redeploying that Apps
   Script deployment has a manifest-access gotcha — see the lead-tracker
   repo before touching it.

The pipeline feed is off until the `PIPELINE_TOKEN` secret is set, so the
worker can be deployed before the repo exists on GitHub.

## Worker (worker/)

- Deploy: `node test-worker.js` (must print "All worker checks passed."),
  then `npx wrangler deploy`. Serves https://api.iternal.co.uk.
- Secrets (set with `npx wrangler secret put <NAME>`): `STRIPE_WEBHOOK_SECRET`,
  `LEAD_API_SECRET`, `PIPELINE_TOKEN` (fine-grained GitHub token, Contents
  read+write on the pipeline repo only).
- KV namespace CLIENTS holds `client:<email>` (paid), `lead:<email>` (unpaid),
  `session:<stripe-session-id>` → email (legacy). Sweep any test records
  after manual testing:
  `npx wrangler kv key delete "lead:<email>" --namespace-id bf744fdf07b945719b644e314b69b780 --remote`
  A test sign-up also leaves a file in the pipeline repo and a row in the
  tracker; remove those too.
- `/signup` is the sign-up form's only destination (FormSubmit is gone from
  that page). Its spam check is the form's hidden honeypot field.

## Payment (handled separately — 30 Sep 2026)

- **Booking a call takes no payment.** The Google Calendar pay-at-booking
  design is dropped. The team requests the deposit separately, around the
  time of the call.
- **The deposit amount is not settled** (£100 or 30% were being considered
  on 30 Sep, instead of the earlier £375). The pages therefore say "£750 all
  in: a deposit to get started, the balance when your site goes live" with
  no figure. When it is decided, the figure goes into `websites.html` (meta
  description, JSON-LD, "How it works") and the terms card in `start.html`.
- The Stripe webhook stays wired and is harmless if unused. If the deposit
  is requested through the Iternal Stripe account, `payment_intent.succeeded`
  marks the client paid in KV, the pipeline repo and the tracker, with the
  amount actually paid. If it arrives any other way, mark it in the
  dashboard — the worker never downgrades a payment recorded there.
- An email-less Stripe payment briefs the team as UNMATCHED, never silent.
- `STRIPE_WEBHOOK_SECRET` holds the **live** webhook's signing secret
  (swapped 2026-09-09).
- The old £375 Payment Link was deactivated 15 Sep.

## Team briefs (email)

Briefs go to every address in `TEAM_EMAIL` (comma-separated), one copy each.
Changing who receives them is a three-step change, not one:

1. Verify each new address as an Email Routing destination
   (Cloudflare → iternal.co.uk → Email Routing; they click a link). Do this
   BEFORE deploying — an unverified address makes its sends fail.
2. `TEAM_EMAIL` in `worker/wrangler.toml`.
3. `allowed_destination_addresses` in the `send_email` binding in the same
   file. The two lists must match.

The From (`funnel@iternal.co.uk`) is a label only — no mailbox behind it, and
clients never see it. Clients get no email from us by design: Google Calendar
sends the booking invite.

## Page-side switches

- `start.html` — the form's `action` is the worker's `/signup`. The page
  shows success only once the worker has the sign-up.
- `questions.html` `WORKER_URL` — `https://api.iternal.co.uk`; an empty
  string falls back to FormSubmit (the pre-worker path, not in use).
- `questions.html` `BOOKING_URL` — the Google Calendar appointment schedule.
  Lives here only. A plain schedule: no payment step.

## Go-live (dark launch)

Merging to main does NOT publish anything: the live site is the
`iternal-site` worker, deployed manually with wrangler from the repo root (no
Git auto-deploy). The funnel is live but DARK: no public page links to it
(the "Websites" nav item is removed everywhere, websites.html/start.html are
noindex, the sitemap omits them), and sign-up is disabled without `?team`.

Before lighting up:

- The pipeline repo exists on GitHub and `PIPELINE_TOKEN` is set.
- websites@iternal.life exists and both brief addresses are verified.
- A `?team` walkthrough has produced a client file, a tracker row and both
  briefs from one real sign-up.
- The deposit wording is settled and the legal pack reviewed.
- Jay's Transport has moved to the new site (the gallery shows the old one
  until then).

LIGHTING UP (when the team says go), then redeploy:

a. `git revert 32b1649` — restores the nav links and flips websites.html +
   start.html robots back to "index, follow" (if it conflicts on the
   _privacy_skeleton scratch files, keep them deleted with `git rm`).
b. `git revert 7620e05 6914250` — removes the preview gate + testing banner
   from start.html. Expect conflicts: that block has been edited since.
   Resolve by deleting the whole `if (PREVIEW)` block and the `PREVIEW`
   checks.
c. Redeploy the site (`npx wrangler deploy` from the repo root).
