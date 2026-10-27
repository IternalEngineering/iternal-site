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
  pipeline repo only), `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` (§Payment).
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
  `acceptedAt`) on the lead record, then, independently: briefs the team
  (payment comes next), posts a note to the tracker and syncs the platform.
  It answers `{ok, pay}`: the client's Stripe payment page (§Payment), where
  start.html sends them. Accepting again changes and sends nothing: unpaid,
  it answers a fresh payment page; paid, `{ok, paid: true}`. If Stripe will
  not make the page (502), the acceptance stands and the client retries.
- start.html keeps the token and the email in localStorage, questions.html prefills the email from it and sends the
  token with every answers post. `/answers` refuses (403) answers for a
  record whose token does not match — knowing an email is not enough to
  rewrite someone's brief. A client on a different browser gets a message
  pointing them to john@iternal.life.
- The steps run in order (Robbie, 27 Oct 2026): sign up, accept, pay, then
  the questions and the booking. `/status` (`{email, token, session}`) answers
  `{accepted, paid}`, plus `booking` (the `BOOKING_URL` link) once paid; the
  questions page shows the questions and the booking only then, and
  otherwise says what is missing ("Sign up first", "Accept our terms
  first", "Your payment hasn't come through yet", each linking back to
  start.html). Straight back from Stripe (`?paid=1&session_id=cs_…`) the
  page sends the session id; the worker asks Stripe for that Checkout
  Session and, if it is paid, ours and this client's, records the payment
  there and then, so the questions open at once (Robbie, 27 Oct 2026: no
  waiting screen). The emails and the tracker note still come from the
  webhook, once. Only if Stripe can't be asked does the page show
  "Confirming your payment" and ask again every 2 seconds for up to 16. The booking link is in no page, so only paid clients get
  it (the confirmation email carries it too).
- Answers count only from a client who has signed up, accepted the terms
  and paid: a booking or send from anyone else is refused (409; the page
  asks them to finish signing up first), and a page saving by itself is
  ignored. So nothing reaches the dashboard's demo queue without an
  agreement and the downpayment.
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
- Tracker posts carry `event` (`signed-up`, `accepted` or `paid`); the
  tracker words its Slack ping by it. A website record starts as "Awaiting
  downpayment" and turns Active on `paid` (lead-tracker, 27 Oct 2026: needs
  the tracker's public API redeployed as well as this worker).
- After the first deploy of this code, delete the secret it no longer uses:
  `npx wrangler secret delete MAGIC_SECRET`. Keep `STRIPE_WEBHOOK_SECRET`:
  `/stripe-webhook` needs it.

## Payment and the terms (27 Oct 2026)

- **The terms and the order set the money.** The Iternal Website Build and
  Care Terms, version 1.0 (`terms/website-build-and-care-v1.0.html` +
  `.pdf`), were supplied 22 Oct 2026 and confirmed final on 27 Oct 2026;
  they are placed word for word (checked word by word against the supplied
  PDF), except "web agent", which reads "Site Agent" on Robbie's word (27 Oct
  2026), and replaced an earlier draft of the same number that was never
  public. They are effective 27 October 2026 (Robbie: "today's date"). They
  fix the £100 upfront payment and
  leave the rest of the build fee and the care plan fee to the order
  details, which take priority over the terms except for clause 17. The
  order states **£750: £100 now, £650 on completion**, and **£50 a month**
  for the care plan, all including VAT (`TERMS` in the worker; `buildFee`
  is the total). Per-client pricing is planned: the order's figures are its
  own fields for that reason.
- **The review screen** is the team's sign-up walkthrough (step 2), word for
  word: order summary, the nine key points (their figures are static text:
  £100, 14 days, 30 days, £2,500), "Read the full terms" (a `<dialog>`
  showing the terms page, with the PDF), the two ticks, "Accept and pay
  £100". The worker records the IP address the acceptance came from
  (`acceptanceIp`, kept off the dashboard record).
- **Accepting forms the agreement**, on start.html, and takes the client
  straight to the downpayment on Stripe (below); the worker records it when
  Stripe confirms it, then the questions and the booking follow.
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
  - The Stripe Price behind `STRIPE_PRICE` (worker/wrangler.toml): its
    amount must equal `TERMS.downpayment`. A new amount is a new Price in
    Stripe and its id in `STRIPE_PRICE`.
  - start.html's "Accept and pay £…" button takes the figure from the order;
    the key points above it restate £100 and £2,500 from the terms.
  - The Lead Tracker (`../lead-tracker`, `apps-script/LeadApi.gs`): every
    website lead starts with `budget: 750`.
- **The downpayment: Stripe Checkout on accepting (team journey, 22 Oct
  2026).** Sign up, review and "Accept and pay £100", pay on Stripe's page,
  then the questions and the booking. The booking itself takes no payment.
  The final payment is completely separate and outside this project. Set up
  once, outside the code:
  1. Stripe → Product catalogue: one Price for the downpayment (£100, one-off,
     described as the upfront payment towards the website build fee) →
     `STRIPE_PRICE`; Tax rates: 20% VAT, **inclusive** → `STRIPE_TAX_RATE`
     (both in `worker/wrangler.toml` `[vars]`). Branding (Settings → Branding)
     carries the Iternal logo and colours; the statement descriptor reads
     ITERNAL.
  2. Stripe → Developers → API keys → Create restricted key: **Checkout
     Sessions: Write**, nothing else → `npx wrangler secret put STRIPE_API_KEY`
     from `worker/` (Robbie puts secrets in himself). Try it in test mode first
     (a test key, Price and tax rate, locally); if Stripe refuses a parameter,
     its error names the permission to add.
  3. Stripe → Developers → Webhooks: endpoint
     `https://api.iternal.co.uk/stripe-webhook` ("site-client-funnel", active),
     event `checkout.session.completed` (its `payment_intent.succeeded` events
     are ignored). Its signing secret is `STRIPE_WEBHOOK_SECRET` on the worker
     (still set on 22 Oct 2026).
  4. The booking schedule (John's Google Calendar) must NOT
     require payment: the client has paid already.

  The worker makes one Checkout Session per visit to the payment step
  (`checkoutUrl`): the Price and tax rate, the client's email, their
  reference as `client_reference_id` and on the VAT invoice Stripe sends
  (`invoice_creation`), "<company>: upfront payment towards your website
  build fee (<reference>)." above the pay button, and asks for nothing but the
  card (no name or billing address: Robbie, 27 Oct 2026), `metadata.funnel = website-build`. Paid, Stripe sends
  them to `/questions?paid=1&session_id=…` ("Thank you, your payment has been received.");
  back without paying, to `/start`, which still shows their order to accept
  and pay again. `handleStripeWebhook` acts only on a paid
  `checkout.session.completed` marked `website-build`; every other payment on
  the account is ignored. It matches the order by reference (`ref:` index),
  records `payment` once (`stripe:<session>` in KV; retries change nothing;
  the same payment already recorded by `/status` is not a second one),
  sends the client's confirmation, briefs the team and notes the tracker. A
  payment for an order already paid, or one whose record has gone, briefs
  the team ("payment needs a look") and nobody else. Payment never reaches
  the platform repo.

  Not built yet (in the team's journey, waiting on Robbie): the reminder on
  day 3 and cancelling the order on day 7 when the £100 is not paid (the
  tracker shows these records as "Awaiting downpayment"); the team's `ITL-…`
  reference format (we issue `WB-yymm-XXXX`).

## Team briefs (email)

Briefs go to every address in `TEAM_EMAIL` (comma-separated), one copy each.
For launch that is john@iternal.life alone (Robbie, 27 Oct 2026: his schedule
takes the calls), which also receives clients' replies (`CLIENT_REPLY_TO`).
The terms name hello@iternal.life for notices, so that inbox must be watched
too; websites@iternal.life
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

## The client's confirmation (email)

Once a client has paid, the worker sends their confirmation, worded as the
team's sign-up example (22 Oct 2026) words it: "Welcome to Iternal: your
website order is confirmed (<reference>)", their order, the booking link
(`BOOKING_URL` in `worker/wrangler.toml`) and the terms PDF attached. It goes
through a second binding,
`CLIENT_MAIL`, which is Cloudflare **Email Service** (outbound, in beta), not
Email Routing: it can reach any address. Setting it up, once:

1. Cloudflare → Email Service: onboard **iternal.co.uk** as a sending domain
   (it adds the DNS records it needs). Sending to any address needs the
   Workers Paid plan.
2. `CLIENT_FROM` (`Iternal <websites@iternal.co.uk>`) must match the
   binding's `allowed_sender_addresses` in `worker/wrangler.toml`. Replies
   go to `CLIENT_REPLY_TO` (john@iternal.life).
3. Deploy the worker. Until all of this is in place every send fails, and
   each failure emails the team "confirmation FAILED" with the text to
   forward by hand, so nobody goes without it.

That is the only email a client gets from us: Stripe sends the receipt and
VAT invoice, Google Calendar the booking invite.

## Page-side switches

- `start.html` — the form's `action` is the worker's `/signup`. The page
  shows success only once the worker has the sign-up.
- `questions.html` `WORKER_URL` — `https://api.iternal.co.uk`; an empty
  string falls back to FormSubmit (the pre-worker path, not in use).
- The booking link — the website-build meeting — lives only in
  `worker/wrangler.toml` `BOOKING_URL` (27 Oct 2026): the questions page gets
  it from `/status` once the client has paid, and the confirmation email
  carries it. For launch it is John's "Disco Meeting"
  (https://calendar.app.google/fNGuEjKBSpoPMhAL6, Robbie 27 Oct 2026), which
  takes no payment (the client paid on accepting, §Payment). It is strictly for
  website-build meetings (Robbie): every other "Book a Call" / "Book a
  Discovery Call" goes to /contact, and those discovery calls stay
  "30 minutes".

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
