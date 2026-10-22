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
   and the "Start yours" button whose `/start?from=<slug>` link tags the
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
   refresh covers it. Screenshots are WebP (`assets/screenshot-<slug>.webp`,
   since 7 Oct 2026); a capture that shows a bot check or sign-in wall
   (Cloudflare, the YouTube "not a bot" prompt) is skipped and last week's
   screenshot stays, so a "skip" line in the job log is expected for sites
   that block headless browsers.
4. `questions.html` — the "Are there any websites you like the look of?"
   options, which mirror the gallery.

## Two destinations (30 Sep 2026)

Every sign-up is sent to two places, independently, by the worker. One
failing never stops the other, and neither can fail the client's request.
Answers go to the platform only, never the tracker.

1. **The Website Build Platform repo** (`PIPELINE_REPO` in `wrangler.toml`,
   locally `Iternal/website-build-platform`). The worker commits one
   `clients/<slug>.json` per client through the GitHub API on sign-up and
   on answers: the full record, with labelled answers, and nothing about
   payment — the platform is for demo building. The dashboard shows it
   and agent sessions work from it. Booking (or sending every answer) sets
   `demoRequested: true`, which queues the pre-call demo build for the
   `website-demo-build` skill. Field ownership is in that repo's README —
   the worker refreshes its own fields and carries everything else over.
2. **The Lead Tracker** — a summary post. Write-only from the funnel (never
   read — the data is private). The worker posts `createLead` to the public
   "Anyone" /exec deployment named in `wrangler.toml`. Redeploying that Apps
   Script deployment has a manifest-access gotcha — see the lead-tracker
   repo before touching it.

The platform feed is off until the `PIPELINE_TOKEN` secret is set (set 1 Oct;
the token awaits org approval), so the worker can deploy regardless.

## Worker (worker/)

- Deploy: `node test-worker.js` (must print "All worker checks passed."),
  then `npx wrangler deploy`. Serves https://api.iternal.co.uk.
- Secrets (set with `npx wrangler secret put <NAME>`): `LEAD_API_SECRET`,
  `PIPELINE_TOKEN` (fine-grained GitHub token, Contents read+write on the
  pipeline repo only).
- KV namespace CLIENTS holds one `lead:<email>` record per client (empty as
  of 7 Oct 2026). Sweep any test records after manual testing:
  `npx wrangler kv key delete "lead:<email>" --namespace-id bf744fdf07b945719b644e314b69b780 --remote`
  A test sign-up also leaves a file in the pipeline repo and a row in the
  tracker; remove those too.
- `/signup` is the sign-up form's only destination (FormSubmit is gone from
  that page). Its spam check is the form's hidden honeypot field. One
  sign-up per email: a second one is refused (409; the page asks them to
  carry on in the browser they signed up in, or email john@iternal.life)
  unless it comes from that browser, which gets the same order back.
  Nothing changes either way, so knowing someone's email is not enough to
  take over their sign-up or accept for them.
- `/signup` answers `{ok, token, order}`. `order` is what start.html's
  "Review and accept" shows: company, name, email, a reference (`WB-yymm-XXXX`,
  made at sign-up and kept), the fees and the terms version, all from the
  worker's `TERMS` constant. `/accept` takes `{email, token, termsVersion,
  accepted, authorised}` and refuses anything short of both ticks, the
  current version (409 hands back the current order to review), a company
  and a name. It stores `acceptance` (the order as shown, plus
  `acceptedAt`) on the lead record, then, independently: emails the client
  their copy with the terms PDF attached (fetched from the site), briefs the
  team (the downpayment comes with the booking), posts a note to the tracker and syncs the
  platform. Accepting twice changes and sends nothing.
- start.html keeps the token and the email in localStorage, questions.html prefills the email from it and sends the
  token with every answers post. `/answers` refuses (403) answers for a
  record whose token does not match — knowing an email is not enough to
  rewrite someone's brief. A client on a different browser gets a message
  pointing them to john@iternal.life.
- Answers count only from a client who has signed up and accepted the
  terms: a booking or send from anyone else is refused (409; the page asks
  them to finish signing up first), and a page saving by itself is ignored.
  So nothing reaches the dashboard's demo queue without an agreement.
- Answers reach the platform as the prospect goes: whenever they switch
  away from or close the questions page with answers newer than the last
  send (`update`), on "Book your call" (`partial`, which records `bookedAt`)
  and on "Send Answers" (`complete`). `update` posts go to the platform only (no team email), never create a record
  without a sign-up, and never queue the demo build: only booking or sending
  does. Each record carries `progress` (furthest step, last active) so the
  dashboard can flag prospects who have gone quiet. The tracker never gets
  answers.
- Archiving is the dashboard's job, not the worker's: the hosted dashboard
  deletes the client's record from the platform repo (their demo and build
  stay: an approved demo becomes the work-in-progress site), appends a line to its
  `history/clients.jsonl` and deletes their KV record here (it shares this
  KV namespace). The worker's only part: a late answer from an archived
  client never recreates their record (it checks that history file). A
  fresh sign-up starts a new one. Details: the platform README, "Archiving
  a client".
- Nothing fails silently: a tracker post the Sheet rejects (anything but
  the tracker's own `{ok: true}`, so an Apps Script sign-in page counts as
  a failure), or a platform sync GitHub rejects (expired token, slug clash,
  bad file), emails the team a "FAILED" brief naming the client. Worker logs
  are retained (`[observability]` in wrangler.toml).
- Tracker posts carry `event` (`signed-up` or `accepted`); the tracker
  words its Slack ping by it. Its "accepted" ping still says to invoice the
  downpayment: update `apps-script/LeadApi.gs` (and redeploy the tracker)
  now that the downpayment comes with the booking.
- After the first deploy of this code, delete the secret it no longer uses:
  `npx wrangler secret delete MAGIC_SECRET`. Keep `STRIPE_WEBHOOK_SECRET`:
  `/stripe-webhook` needs it.

## Payment and the terms (13 Oct 2026)

- **The terms and the order set the money.** The Website Build and Care
  Terms, version 1.0 (`terms/website-build-and-care-v1.0.html` + `.pdf`,
  supplied 13 Oct 2026 and placed word for word), set a £750 + VAT build fee
  paid 50/50 "unless your order details state a different amount", and say
  the order details take priority where they differ. Since 20 Oct 2026
  (Robbie) the order states a **£100 downpayment + £650 upon completion,
  including VAT** (`TERMS.downpayment` and `TERMS.completion` in the worker; the
  order also carries the £750 total as `buildFee`). The care plan is **£50 a
  month including VAT**. Every figure in the order includes VAT, the order
  again overriding the terms' "all fees exclude VAT"; from the month after the site goes live, which includes Site
  Agent (our agentic studio). Invoices are payable within 14 days. Per-client
  pricing is planned: the order's figures are its own fields for that reason.
- **Accepting is the last step of sign-up**, on start.html, and forms the
  agreement. The downpayment is taken when the client books their call (below);
  the worker records it when Stripe confirms it.
- **Changing a price, or a new version of the terms.** A new version is
  supplied wording, never ours. It means: a new pair of files in `terms/`
  (print the PDF with `node tools/terms-pdf.mjs terms/<page>.html`; keep the
  old pair, since clients who accepted it are bound by it), `TERMS` in
  `worker/worker.js` (version, downpayment, completion and care plan; then
  the worker tests and a worker deploy), the terms link in start.html's hero note, and the figures the
  pages restate. Search both files for `£` to find them:
  - `websites.html`: none. Robbie took the pricing off the gallery page on
    20 Oct 2026 ("How it works", "Looking after your site" and the prices in
    its descriptions), ahead of moving to "£100 to start, quoted after the
    call" once new terms are supplied.
  - `start.html`: `sampleOrder()`, the preview's stand-in order (until it
    is removed at light-up). The real order table on "Review and accept"
    takes its figures from the worker. The meta description no longer
    carries prices (20 Oct 2026).
  - The booking page's payment amount (Google Calendar, hello@iternal.life):
    it must equal the downpayment, or the worker ignores the payment as not
    a booking.
  - The Lead Tracker (`../lead-tracker`, `apps-script/LeadApi.gs`): every
    website lead starts with `budget: 750`.
- **Booking payment (restored 22 Oct 2026, at the team's request).** A booking
  is confirmed only once its £100 payment is. The final payment is completely
  separate and outside this project. Three parts, two of them set up outside
  the code:
  1. The website-build booking schedule lives in the **hello@iternal.life**
     Google account (Robbie, 22 Oct 2026; not John's). It requires payment:
     Calendar → the appointment schedule → Payments → Require payment, connect
     Iternal's Stripe account, amount £100 = `TERMS.downpayment`. Google then
     confirms a booking only once Stripe has taken it. (Needs a Workspace plan
     that offers payments; Stripe's brand name is "Iternal Ltd".) Its booking
     link goes in `questions.html` `BOOKING_URL` (Page-side switches).
  2. Stripe dashboard → Developers → Webhooks: endpoint
     `https://api.iternal.co.uk/stripe-webhook`, events
     `payment_intent.succeeded` and `checkout.session.completed`. Its signing
     secret is `STRIPE_WEBHOOK_SECRET` on the worker (still set on 22 Oct 2026;
     `npx wrangler secret put STRIPE_WEBHOOK_SECRET` from `worker/` if the
     endpoint is recreated or its secret rolled).
  3. The worker (`handleStripeWebhook`) acts only on a payment of the booking
     amount (the client's order downpayment, else `TERMS.downpayment`); every
     other payment on the account is ignored, so the two must stay equal. It
     matches the payer by email, records the payment once
     (`stripe:<payment intent>` in KV; retries and duplicate events change
     nothing), briefs the team and notes it in the tracker. A booking paid
     from an email that matches no sign-up arrives as an UNMATCHED brief; one
     whose event names no payer warns the team and stays open for the
     Checkout event that names them. Payment never reaches the platform repo.
     The questions page tells the client booking takes their downpayment and
     the call is confirmed once it is paid.

## Team briefs (email)

Briefs go to every address in `TEAM_EMAIL` (comma-separated), one copy each.
Since 20 Oct 2026 that is john@iternal.life alone (Robbie: default to John),
who also receives clients' replies (`CLIENT_REPLY_TO`); websites@iternal.life
can join once it exists. Changing who receives them is a three-step change,
not one:

1. Verify each new address as an Email Routing destination
   (Cloudflare → iternal.co.uk → Email Routing; they click a link). Do this
   BEFORE deploying — an unverified address makes its sends fail.
2. `TEAM_EMAIL` in `worker/wrangler.toml`.
3. `allowed_destination_addresses` in the `send_email` binding in the same
   file. The two lists must match.

The From (`funnel@iternal.co.uk`) is a label only — no mailbox behind it, and
clients never see it.

## The client's copy (email)

The terms promise each client "a copy of both" (the terms and their order)
when they accept. The worker sends it through a second binding,
`CLIENT_MAIL`, which is Cloudflare **Email Service** (outbound, in beta), not
Email Routing: it can reach any address. Setting it up, once:

1. Cloudflare → Email Service: onboard **iternal.co.uk** as a sending domain
   (it adds the DNS records it needs). Sending to any address needs the
   Workers Paid plan.
2. `CLIENT_FROM` (`Iternal <websites@iternal.co.uk>`) must match the
   binding's `allowed_sender_addresses` in `worker/wrangler.toml`. Replies
   go to `CLIENT_REPLY_TO` (john@iternal.life).
3. Deploy the worker. Until all of this is in place every send fails, and
   each failure emails the team "client copy FAILED" with the text to
   forward by hand, so nobody goes without their copy.

That is the only email a client gets from us: Google Calendar sends the
booking invite.

## Page-side switches

- `start.html` — the form's `action` is the worker's `/signup`. The page
  shows success only once the worker has the sign-up.
- `questions.html` `WORKER_URL` — `https://api.iternal.co.uk`; an empty
  string falls back to FormSubmit (the pre-worker path, not in use).
- `questions.html` `BOOKING_URL` — the website-build meeting. From 22 Oct 2026 the
  schedule lives in the hello@iternal.life Google account and requires the £100
  booking payment (§Payment); until its link is in, this still holds John's
  "Disco Meeting" (https://calendar.app.google/fNGuEjKBSpoPMhAL6), which has no
  payment. It is strictly for website-build meetings (Robbie): every other
  "Book a Call" / "Book a Discovery Call" goes to /contact, and those discovery
  calls stay "30 minutes".
  Lives here only. It requires payment through Stripe: see §Payment.

## Go-live (dark launch)

**Pushing to main publishes the site.** Cloudflare builds the `iternal-site`
worker from GitHub about a minute after every push to main (confirmed
20 Oct 2026: pushed 10:51, live 10:52), the weekly screenshot commit
included. A manual `npx wrangler deploy` from the repo root still works and
ships the local working tree. The funnel is live but DARK: no public page links to it
(no menu item or Services entry leads to it, websites.html/start.html are
noindex, the sitemap omits them), and without `?team` the sign-up and
questions pages are a preview: every screen can be stepped through, but
nothing is sent and no call is booked (`preview.js`).

Before lighting up (Robbie, 20 Oct 2026: anything quick to update once
live is not a blocker):

- The pipeline repo exists on GitHub and `PIPELINE_TOKEN` is set.
- john@iternal.life is a verified Email Routing destination, and the worker
  is deployed.
- The team has stepped through every screen in the preview (gallery,
  sign-up, review and accept, questions, booking) and is happy with it.
- A `?team` test run has produced, from one real sign-up and acceptance, a
  client file with its acceptance, a tracker row and the team brief; then
  sweep the test records (§Worker).

After lighting up (follow-ups, not blockers): onboard iternal.co.uk as an
Email Service sending domain (until then each client's copy reaches John to
forward); create websites@iternal.life and add it to the briefs; refresh the
gallery's Jay's Transport card if their site changes.

LIGHTING UP (when the team says go). Made directly on main on the day,
never prepared ahead: a deploy ships main, so these edits can only land
when the answer is go. About ten minutes; one commit, then the deploy.

1. **The way in is Services, not the menu.** websites.html, start.html and
   questions.html already mark "Services" as the current section.
   On main the Websites entry and homepage row are already in place but
   carry `hidden`, and the contact option is left out (the rework release,
   Oct 2026).
   - services.html: delete `hidden` from `<div class="tier tier-wide"
     id="websites" hidden>` and the comment line above it. Also add
     ", and websites" back to the end of its three meta descriptions
     ("…strategy and advisory, AI augmentation, and websites.").
   - index.html: delete `hidden` from the Websites row in "Ways to work"
     (`<div class="svc" hidden>`) and the comment line above it.
   - contact.html: add `<option>Websites</option>` to "What kind of
     engagement?", before "Not sure yet" (the `?service=websites`
     pre-select already maps to it).
   - Check: `grep -c 'hidden' services.html index.html` no longer counts
     the Websites lines, and `grep -c '<option>Websites' contact.html` gives 1.
2. **Indexing.** websites.html and start.html: `<meta name="robots"
   content="noindex, follow">` becomes `index, follow`. questions.html stays
   `noindex` (a step page, reached only after sign-up).
3. **The sitemap.** In `sitemap.xml`, after contact:
   `<url><loc>https://iternal.co.uk/websites</loc><lastmod>YYYY-MM-DD</lastmod><priority>0.8</priority></url>`,
   with that day's date. In `llms.txt`, add a Websites entry under "## Services", after AI
   Strategy & Advisory: `- [Websites](https://iternal.co.uk/websites): Not every project needs a
   platform. Sometimes you need a really good website, designed, built and live in weeks.`
4. **The preview gate**, in start.html's script: delete the "Dark-launch
   preview gate" block (the `PREVIEW` constant, the disabled button, the
   "Preview" notes and the gold "In testing" banner), the
   `if (PREVIEW) return;` line in the form's submit handler, and the
   `if (!PREVIEW) { … }` wrapper round restoring the kept order (keep the
   line inside it). Also delete `preview.js`, its `<script
   src="preview.js">` tag on start and questions, and every `PREVIEW` line
   in both pages (`sampleOrder()` included). Check: `grep -n PREVIEW
   *.html` finds nothing.
5. **The docs.** CLAUDE.md "Currently DISABLED / dark": replace the dark
   launch and preview gate items with one saying the section is public.
   This section: mark it lit, with the date. SITE-CHANGES.md: one line
   under "Waiting to deploy".
6. **Check, then deploy.** Serve the repo (`iternal-site` launch config),
   open start.html without `?team`: no banner, and a real test sign-up
   gets as far as "Review and accept". Then, on the word "deploy the
   site", push main: that deploys it within about a minute.
