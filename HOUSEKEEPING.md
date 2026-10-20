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
  that page). Its spam check is the form's hidden honeypot field.
- `/signup` answers `{ok, token, order}`. `order` is what start.html's
  "Review and accept" shows: company, name, email, a reference (`WB-yymm-XXXX`,
  made at sign-up and kept), the fees and the terms version, all from the
  worker's `TERMS` constant. `/accept` takes `{email, token, termsVersion,
  accepted, authorised}` and refuses anything short of both ticks, the
  current version (409 hands back the current order to review), a company
  and a name. It stores `acceptance` (the order as shown, plus
  `acceptedAt`) on the lead record, then, independently: emails the client
  their copy with the terms PDF attached (fetched from the site), briefs the
  team to invoice the first 50%, posts a note to the tracker and syncs the
  platform. Accepting twice changes and sends nothing.
- start.html keeps the token and the email in localStorage, questions.html prefills the email from it and sends the
  token with every answers post. `/answers` refuses (403) answers for a
  record whose token does not match — knowing an email is not enough to
  rewrite someone's brief. A client on a different browser gets a message
  pointing them to john@iternal.life.
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
- Nothing fails silently: a tracker post the Sheet rejects, or a platform
  sync GitHub rejects (expired token, slug clash, bad file), emails the team
  a "FAILED" brief naming the client. Worker logs are retained
  (`[observability]` in wrangler.toml).

## Payment and the terms (13 Oct 2026)

- **The terms set the money.** The Website Build and Care Terms, version
  1.0 (`terms/website-build-and-care-v1.0.html` + `.pdf`, supplied 13 Oct
  2026 and placed word for word): build fee £750 + VAT, 50% payable on
  accepting them and 50% on completion; care plan £50 a month + VAT from the
  month after the site goes live, which includes the web agent (our studio).
  Invoices are payable within 14 days.
- **Accepting is the last step of sign-up**, on start.html, and forms the
  agreement. The worker briefs the team to invoice the first 50%. Nothing on
  the site takes payment, and booking a call takes none.
- **Changing a price, or a new version of the terms.** A new version is
  supplied wording, never ours. It means: a new pair of files in `terms/`
  (print the PDF with `node tools/terms-pdf.mjs terms/<page>.html`; keep the
  old pair, since clients who accepted it are bound by it), `TERMS` in
  `worker/worker.js` (version and fees; then the worker tests and a worker
  deploy), the terms link in start.html's hero note, and the figures the
  pages restate. Search both files for `£` to find them:
  - `websites.html`: the meta description, the JSON-LD description, the
    bold opening sentence of "How it works", and "Looking after your site".
  - `start.html`: the meta description, and `sampleOrder()`, the
    walkthrough's stand-in order (until it is removed at light-up). The real
    order table on "Review and accept" takes its figures from the worker.
- **No payment code anywhere (Robbie, 7 Oct 2026).** The Stripe webhook
  and its payment records were removed from the worker; whether and when a
  client has paid is kept by hand in the Lead Tracker. The old £375 Payment
  Link was deactivated 15 Sep.

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
- `questions.html` `BOOKING_URL` — the Google Calendar appointment schedule.
  Lives here only. A plain schedule: no payment step.

## Go-live (dark launch)

Merging to main does NOT publish anything: the live site is the
`iternal-site` worker, deployed manually with wrangler from the repo root (no
Git auto-deploy). The funnel is live but DARK: no public page links to it
(the "Websites" nav item is removed everywhere, websites.html/start.html are
noindex, the sitemap omits them), and sign-up is disabled without `?team`.

Before lighting up (Robbie, 20 Oct 2026: anything quick to update once
live is not a blocker):

- The pipeline repo exists on GitHub and `PIPELINE_TOKEN` is set.
- john@iternal.life is a verified Email Routing destination, and the worker
  is deployed.
- The team has stepped through every screen in walkthrough mode
  (`websites.html?walkthrough`: nothing is sent, nothing is booked) and is
  happy with it.
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

1. **The menu.** Add "Websites" straight after "Work", in both the desktop
   menu (`<ul class="nav-links">`: `<li><a href="websites.html">Websites</a></li>`)
   and the phone menu (`<div class="mobile-nav">`:
   `<a href="websites.html">Websites</a>`), on all eleven pages without it:
   index, services, about, insights, contact, privacy, and the five
   `case-*.html` pages. websites.html, start.html and questions.html have it
   already. Check: `grep -c 'href="websites.html">Websites' *.html` gives 2
   on every page except websites.html, which gives 1 (its desktop link
   carries `class="active"`).
2. **Indexing.** websites.html and start.html: `<meta name="robots"
   content="noindex, follow">` becomes `index, follow`. questions.html stays
   `noindex` (a step page, reached only after sign-up).
3. **The sitemap.** In `sitemap.xml`, after contact:
   `<url><loc>https://iternal.life/websites.html</loc><priority>0.8</priority></url>`.
4. **The preview gate**, in start.html's script: delete the "Dark-launch
   preview gate" block (the `PREVIEW` constant, the disabled button, the
   "Preview" notes and the gold "In testing" banner), the
   `if (PREVIEW) return;` line in the form's submit handler, and the
   `if (!PREVIEW) { … }` wrapper round restoring the kept order (keep the
   line inside it). Also the walkthrough: delete `walkthrough.js`, its
   `<script src="walkthrough.js">` tag on websites, start and questions, and
   the `WALK` lines in start.html and questions.html (`sampleOrder()`
   included). Check: `grep -n PREVIEW start.html` and
   `grep -n -i walkthrough *.html` find nothing.
5. **The docs.** CLAUDE.md "Currently DISABLED / dark": replace the dark
   launch and preview gate items with one saying the section is public.
   This section: mark it lit, with the date. SITE-CHANGES.md: one line
   under "Waiting to deploy".
6. **Check, then deploy.** Serve the repo (`iternal-site` launch config),
   open start.html without `?team`: no banner, and a real test sign-up
   gets as far as "Review and accept". Then `git status` (a deploy ships
   the working tree) and `npx wrangler deploy` from the repo root, on the
   word "deploy the site".
