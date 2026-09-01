# Housekeeping — the funnel's moving parts

Couplings and switches that aren't visible from any single file. Update this
when one of them changes.

## Questions ↔ worker briefs

The question wording lives twice:

- `questions.html` — the `QUESTIONS` array the client sees.
- `worker/worker.js` — the `QUESTIONS` id→wording map that renders team briefs.

Reword, add, or remove a question → make the matching one-line change in the
worker map and redeploy. If they drift, nothing breaks: briefs fall back to
the raw field id (`mainJob: …`) and no answer is ever dropped.

## Adding a site to the gallery

The gallery is curated — a new site going live does NOT automatically earn a
place. Adding one is a deliberate call, made by a person, per site. Once that
call is made, three files move together:

1. `websites.html` — the gallery entry (label, description, screenshot img).
2. `tools/screenshots.js` — the `SHOTS` list, so the weekly screenshot
   refresh covers it.
3. `questions.html` — the "Which of our sites do you like the look of?"
   options, which mirror the gallery.

## Worker (worker/)

- Deploy: `node test-worker.js` (must print "All worker checks passed."),
  then `npx wrangler deploy`. Serves https://api.iternal.co.uk.
- Secrets (set with `npx wrangler secret put <NAME>`): `STRIPE_WEBHOOK_SECRET`,
  `LEAD_API_SECRET`.
- KV namespace CLIENTS holds `client:<email>` (paid), `lead:<email>` (unpaid),
  `session:<stripe-session-id>` → email (lets the payment redirect claim its
  answers). Sweep any test records after manual testing:
  `npx wrangler kv key delete "lead:<email>" --namespace-id bf744fdf07b945719b644e314b69b780 --remote`

## Stripe

- The webhook endpoint subscribes to `checkout.session.completed` only.
- The Payment Link must redirect to exactly
  `https://iternal.co.uk/questions.html?paid=1&session={CHECKOUT_SESSION_ID}`
  (Stripe substitutes the template) with require-ToS ticked and receipt on.
- `STRIPE_WEBHOOK_SECRET` currently holds the **sandbox** signing secret.
  At go-live, swap it for the live webhook's secret.

## Team briefs (email)

Changing who receives briefs is a three-step change, not one:

1. Verify the new address as an Email Routing destination
   (Cloudflare → iternal.co.uk → Email Routing; they click a link).
2. `TEAM_EMAIL` in `worker/wrangler.toml`.
3. `destination_address` in the `send_email` binding in the same file.

The From (`funnel@iternal.co.uk`) is a label only — no mailbox behind it, and
clients never see it. Clients get no email from us by design: Stripe sends the
receipt, Google Calendar sends the booking invite.

## Page-side switches (questions.html)

- `WORKER_URL` — `https://api.iternal.co.uk`; empty string falls back to
  FormSubmit (the pre-worker path).
- `BOOKING_URL` — the Google Calendar appointment schedule. Lives here only.

## Lead Tracker

Write-only from the funnel (never read — the data is private). The worker
posts `createLead` to the public "Anyone" /exec deployment named in
`wrangler.toml`. Redeploying that Apps Script deployment has a
manifest-access gotcha — see the lead-tracker repo before touching it.
