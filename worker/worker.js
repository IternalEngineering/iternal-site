/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Flow: the client signs up on start.html, reviews their order and accepts
 * the Website Build and Care Terms there, pays the downpayment on a Stripe
 * Checkout page made for their order, answers the questions, then books their
 * call on the Google Calendar appointment page. Stripe tells this worker when
 * they have paid, and the worker sends their confirmation.
 *
 * Everything a client enters goes to TWO destinations, independently:
 *   1. the website-build pipeline repo (PIPELINE_REPO) — the full record,
 *      one clients/<slug>.json per client, which the information & demo
 *      build dashboard shows and agent sessions work from;
 *   2. the Lead Tracker — a summary post (write-only by policy).
 *
 * Routes:
 *   POST /signup          The start.html form posts here after sign-up:
 *                         seeds their lead record in KV, then both
 *                         destinations (fire-and-forget, never blocking).
 *                         Answers with the order to review. Turnstile-checked.
 *   POST /accept         The client accepts the terms: records what they
 *                         accepted, tells the team, updates both destinations
 *                         and answers with their Stripe payment page.
 *                         Accepting again (back from Stripe unpaid) answers
 *                         with a fresh payment page and nothing else.
 *   POST /status          The questions page asks where the client is: the
 *                         questions and the booking open only once they have
 *                         paid, and only then does it answer with the
 *                         booking link.
 *   POST /answers        The questions page posts drafts/finals here, keyed
 *                         by the email they give in the first question. The
 *                         first answers queue the pre-call demo build
 *                         (demoRequested) in the pipeline repo.
 *   POST /stripe-webhook  Stripe calls this when a Checkout payment completes.
 *                         Only the payment pages this worker made concern the
 *                         funnel: matched to the sign-up by reference, the
 *                         payment is recorded in KV, the client is sent their
 *                         confirmation, and the team and the tracker are told.
 *                         Every other payment on the account, the final payment
 *                         included, is outside this project and ignored.
 *                         Payment never reaches the pipeline repo.
 *   GET  /health          Liveness check.
 *
 * Clients get ONE email from us: once they have paid, the confirmation of their
 * order with the terms attached (CLIENT_MAIL, Cloudflare Email Service). Stripe
 * sends the receipt and VAT invoice, Google Calendar the booking invite. Team
 * briefs go via Cloudflare's native email (TEAM_MAIL) to verified destinations.
 *
 * Explicitly NOT here: card details (Stripe's own page takes them), booking
 * (Google Calendar's), and any READ of the Lead Tracker (write-only by policy).
 *
 * Secrets (wrangler secret put): STRIPE_API_KEY (a restricted key that can only
 * create Checkout Sessions), STRIPE_WEBHOOK_SECRET (the signing secret of the
 * /stripe-webhook endpoint in Stripe's dashboard), LEAD_API_SECRET,
 * PIPELINE_TOKEN (GitHub token with contents:write on PIPELINE_REPO only).
 */

const enc = new TextEncoder();

function json(status, obj, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.SITE_URL || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

async function sendTeamEmail(env, subject, text) {
  if (!env.TEAM_MAIL) return;
  const from = env.FROM_EMAIL;
  // The envelope wants bare addresses; the display name lives in the MIME From.
  const bare = a => { const m = /<([^>]+)>/.exec(a); return m ? m[1] : a; };
  // In the Workers runtime this import exists; in the Node self-check it
  // throws and the stub binding receives the plain object instead.
  let EmailMessage = null;
  try { ({ EmailMessage } = await import('cloudflare:email')); } catch (e) {}
  // TEAM_EMAIL is a comma-separated list. One message per recipient: an
  // EmailMessage carries a single envelope recipient, and one bad address
  // must not sink the others.
  const recipients = String(env.TEAM_EMAIL || '').split(',').map(a => a.trim()).filter(Boolean);
  subject = String(subject).replace(/[\r\n]+/g, ' '); // client text reaches subjects; a line break would forge headers
  const results = await Promise.allSettled(recipients.map(to => {
    // Cloudflare refuses a message without a Message-ID ("invalid message-id").
    const raw = 'From: ' + from + '\r\n' + 'To: ' + to + '\r\n' +
      'Message-ID: <' + crypto.randomUUID() + '@' + bare(from).split('@')[1] + '>\r\n' +
      'Subject: ' + subject + '\r\n' + 'Date: ' + new Date().toUTCString() + '\r\n' +
      'Content-Type: text/plain; charset=utf-8' + '\r\n\r\n' + text;
    return env.TEAM_MAIL.send(EmailMessage ? new EmailMessage(bare(from), bare(to), raw) : { from, to, raw });
  }));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    const why = failed[0].reason;
    console.error(`team brief FAILED for ${failed.length}/${recipients.length} recipient(s):`, why && why.message ? why.message : why);
    if (failed.length === recipients.length) throw why;
  } else {
    console.log('team brief sent:', subject);
  }
}

async function postToLeadTracker(env, lead) {
  if (!env.LEAD_API_URL || !env.LEAD_API_SECRET) return;
  const url = `${env.LEAD_API_URL}?key=${encodeURIComponent(env.LEAD_API_SECRET)}&action=createLead`;
  let why = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(lead),
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    // Only the tracker's own {ok: true} counts: Apps Script answers a sign-in
    // or "unable to open" page with status 200 too.
    if (!res.ok || body.ok !== true) why = `HTTP ${res.status}${body.error ? ' — ' + body.error : body.ok === undefined ? ' — not a tracker reply' : ''}`;
  } catch (e) { why = e && e.message ? e.message : String(e); }
  if (!why) return;
  // Never silent: the client saw "ok", so the team must hear it went missing.
  console.error('tracker post FAILED:', why, lead.email);
  await sendTeamEmail(env, `Website Pipeline: tracker post FAILED — ${lead.email}`,
    `The Lead Tracker did not accept this post (${why}). Add them by hand:

${JSON.stringify(lead, null, 2)}`);
}

const s = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ── The terms the client accepts ─────────────────────────────────────────
   The current version and the fees its order details print. Each version is
   published as terms/website-build-and-care-v<version>.html and .pdf on the
   site and never edited: a new version is new files plus a change here. */
// The standard order. The terms (supplied 22 Oct 2026, final 27 Oct 2026) fix the
// £100 upfront payment and leave the rest of the build fee and the care plan fee to
// the order details; every price includes VAT.
const TERMS = { name: 'Iternal Website Build and Care Terms', version: '1.0', downpayment: 100, completion: 650, carePlan: 50 };
const termsUrl = (env, version, ext) => `${env.SITE_URL}/terms/website-build-and-care-v${version}.${ext}`;

/** A reference no client has had before: drawn at random, checked against the
    `ref:<reference>` index and claimed there. The index is never deleted (archiving
    removes only the lead record), so a reference is never handed out twice.
    ponytail: KV has no atomic claim; two sign-ups drawing the same reference in the
    same second is the gap (one in a million per month, squared). */
async function newReference(env, email) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
  for (let attempt = 0; attempt < 20; attempt++) {
    const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => abc[b % abc.length]).join('');
    const ref = 'WB-' + new Date().toISOString().slice(2, 7).replace('-', '') + '-' + tail;
    if (await env.CLIENTS.get(`ref:${ref}`)) continue;
    await env.CLIENTS.put(`ref:${ref}`, email);
    return ref;
  }
  throw new Error('no free reference after 20 draws');
}

/** The order details as the client reviews them, from their lead record. */
const orderOf = kv => ({
  company: kv.org || '', name: kv.name || '', email: kv.email, reference: kv.reference || '',
  buildFee: TERMS.downpayment + TERMS.completion, downpayment: TERMS.downpayment, completion: TERMS.completion,
  carePlan: TERMS.carePlan, termsVersion: TERMS.version,
});

/** The order as plain-text lines, worded as on the acceptance screen. */
const orderText = o => [
  ['Name or business name', o.company], ['Your name', o.name], ['Email', o.email], ['Reference', o.reference],
  ['Build fee', `£${o.buildFee}. £${o.downpayment} payable now, before your initial conversation; £${o.completion} on completion. Prices include VAT`],
  ['Care plan', `£${o.carePlan} per month, from the month after your site goes live. Payable monthly, quarterly, half-yearly or annually in advance`],
  ['Terms', `${TERMS.name}, version ${o.termsVersion}`],
].map(([k, v]) => `${k}: ${v}`).join('\n');

const ukTime = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' });

/** The confirmation the client gets once they have paid, worded as the team's
    sign-up example (22 Oct 2026) words it. If it cannot go, the team gets it to forward. */
async function sendConfirmation(env, acc) {
  const pdfUrl = termsUrl(env, acc.termsVersion, 'pdf');
  const at = { timeZone: 'Europe/London' };
  const text = `Hi ${acc.name.split(' ')[0]},

Thank you for choosing Iternal to build and look after your website. This email confirms your order, and a copy of our ${TERMS.name} (version ${acc.termsVersion}) is attached for your records.

Your order
Name or business name: ${acc.company}
Reference: ${acc.reference}
Build fee: £${acc.buildFee}, with £${acc.downpayment} paid today and £${acc.completion} payable on completion
Care plan: £${acc.carePlan} per month, starting from the month after your site goes live
Accepted by: ${acc.name} on ${new Date(acc.acceptedAt).toLocaleDateString('en-GB', { ...at, dateStyle: 'long' })} at ${new Date(acc.acceptedAt).toLocaleTimeString('en-GB', { ...at, timeStyle: 'short' })}

What happens next
Thank you for your upfront payment; your VAT invoice will arrive separately from Stripe. If you have not already booked your initial conversation with one of our team, you can do so here: ${env.BOOKING_URL}. If you would like to pay your care plan quarterly, half-yearly or annually rather than monthly, just reply to this email and let us know.

If anything in your order details looks wrong, please reply within 7 days so we can put it right.

We look forward to working with you.
The Iternal team
`;
  try {
    if (!env.CLIENT_MAIL) throw new Error('no CLIENT_MAIL binding');
    const pdf = await fetch(pdfUrl);
    if (!pdf.ok) throw new Error(`terms PDF ${pdf.status}`);
    const [, fromName, fromEmail] = /^(.*?)\s*<([^>]+)>$/.exec(env.CLIENT_FROM) || [, '', env.CLIENT_FROM];
    await env.CLIENT_MAIL.send({
      to: acc.email, from: { name: fromName, email: fromEmail }, replyTo: env.CLIENT_REPLY_TO,
      subject: `Welcome to Iternal: your website order is confirmed (${acc.reference})`,
      text,
      attachments: [{ content: await pdf.arrayBuffer(), filename: `${TERMS.name} v${acc.termsVersion}.pdf`, type: 'application/pdf', disposition: 'attachment' }],
    });
    console.log('confirmation sent:', acc.reference);
  } catch (e) {
    const why = e && e.message ? e.message : String(e);
    console.error('confirmation FAILED:', why, acc.email);
    await sendTeamEmail(env, `Website Pipeline: confirmation FAILED — ${acc.company}`,
      `${acc.name} paid, but their confirmation email did not send (${why}).
Forward the text below to ${acc.email}, with the terms PDF attached (${pdfUrl}).

----

${text}`);
  }
}

/* Gallery slugs as sent by websites.html's per-site "start here" buttons
   (?from=slug). Coupled to the gallery — see HOUSEKEEPING.md. */
const GALLERY_SITES = {
  tech4good: 'Tech4Good South West',
  agf: 'African Gifted Foundation',
  genius: 'Generating Genius',
  marvinrees: 'marvinrees.com',
  bplaced: 'bPlaced',
  pawlett: 'Pawlett Pavilion',
  jays: "Jay's Transport",
  cnz: 'CivicNetZero',
};

/* Field ids as sent by questions.html, in the order they appear on the page.
   Keeps team briefs readable as real Q&A; unknown ids fall back to the raw key. */
const QUESTIONS = [
  ['email', 'Your work email'],
  ['mainJob', "What's the site's main job?"],
  ['hasSite', 'Do you have a website today?'],
  ['audience', 'Who do you most want the site to reach?'],
  ['timeline', 'When would you like to launch?'],
  ['mustDo', "When someone visits, what's the one thing you'd like them to do?"],
  ['admired', 'Are there any websites you like the look of?'],
  ['loved', 'Websites you love'],
  ['avoid', 'Websites or design choices to avoid'],
  ['branding', 'Do you have branding — a logo, colours?'],
  ['visualStyle', 'Which look pulls you more?'],
  ['pages', 'Which pages do you think you need?'],
  ['content', 'Where will the words come from?'],
  ['assets', 'What do you already have that we can use?'],
  ['wrong', 'If you have a site now — what does it get wrong?'],
  ['feel', 'When someone you respect sees the finished site, what should they think?'],
  ['anything', 'Anything else we should know before the call?'],
];

function answersBrief(answers) {
  const labels = new Map(QUESTIONS);
  const order = [...labels.keys(), ...Object.keys(answers).filter(k => !labels.has(k))];
  return order.filter(k => k in answers).map(k => {
    const v = answers[k];
    return (labels.get(k) || k) + '\n  ' + (Array.isArray(v) ? v.join(', ') : v);
  }).join('\n\n');
}

/* ── Website-build pipeline repo ──────────────────────────────────────────
   One clients/<slug>.json per client, committed through the GitHub Contents
   API. KV stays the worker's own store; this projects it into the repo the
   dashboard and the demo-build agents read. Field contract: that repo's
   README. */

const pipelineSlug = email => email.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const b64encode = str => { let bin = ''; for (const b of enc.encode(str)) bin += String.fromCharCode(b); return btoa(bin); };
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* How far a prospect got, and when they were last active, so the team can see
   who stopped where and chase them up. Booking means clicking "Book your call";
   whether they finished booking in Google Calendar is not visible to us. */
const CORE = ['mainJob', 'hasSite', 'audience', 'timeline']; // the essentials besides email
function progressOf(kv) {
  const a = kv.answers || {};
  const given = id => { const v = a[id]; return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== ''; };
  const step = kv.answersComplete ? 'sent'
    : kv.bookedAt ? 'booked'
    : CORE.every(given) ? 'essentials-done'
    : Object.keys(a).some(id => id !== 'email' && given(id)) ? 'answering'
    : kv.acceptance ? 'terms-agreed'
    : 'signed-up';
  const lastActiveAt = [kv.signedUpAt, kv.acceptance && kv.acceptance.acceptedAt, kv.answersUpdatedAt, kv.bookedAt].filter(Boolean).sort().pop() || null;
  return { step, lastActiveAt };
}

/* The worker owns the fields it sets here and refreshes them from KV on every
   event. Everything else in the file (stageHistory notes, demo, research,
   notes, a cleared demoRequested) belongs to the dashboard and the agents and
   is carried over untouched. */
function projectToPipeline(kv, file, slug) {
  const today = new Date().toISOString().slice(0, 10);
  const rec = file || {
    slug, stage: 'signed-up',
    stageHistory: [{ stage: 'signed-up', date: today, note: 'signed up on the website' }],
    demoRequested: false, demo: null, research: '', notes: '', demoQueuedAt: null,
  };
  const raw = kv.answers || {};
  const labels = new Map(QUESTIONS);
  const prev = new Map((rec.answers || []).map(a => [a.id, a]));
  // Every question, in page order, answered or not (answer: null) — so the
  // dashboard can fill in what a client skipped without its own copy of the
  // question list. Then anything outside the map, from either side.
  const ids = [...new Set([...labels.keys(), ...Object.keys(raw), ...prev.keys()])];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  rec.email = kv.email;
  rec.contact = kv.name || '';
  rec.org = kv.org || kv.name || kv.email;
  rec.website = kv.website || '';
  rec.inspiration = kv.inspiration || '';
  rec.signedUpAt = kv.signedUpAt || rec.signedUpAt || null;
  // Shown to the client at sign-up, so the team can match it before acceptance.
  rec.reference = kv.reference || rec.reference || null;
  // What they accepted, exactly as it stood: the order details and the terms
  // version, and when.
  rec.acceptance = kv.acceptance || rec.acceptance || null;
  rec.answers = ids.map(id => {
    const fromClient = id in raw ? raw[id] : null;
    const was = prev.get(id);
    // A team edit carries `client`: what the client had said when the team
    // changed it. The edit stands until the client changes that answer
    // themselves, and then theirs is the newer word.
    if (was && 'client' in was && same(was.client, fromClient)) return { ...was, question: labels.get(id) || was.question || id };
    return { id, question: labels.get(id) || id, answer: fromClient };
  });
  rec.answersComplete = !!kv.answersComplete;
  rec.answersUpdatedAt = kv.answersUpdatedAt || null;
  rec.progress = progressOf(kv);
  // Payment is deliberately NOT on this record: the platform is for demo
  // building; whether a client has paid lives in the Lead Tracker.

  // Booking (or sending every answer) queues the pre-call demo build, once.
  // Answers saved as a prospect leaves the page do not: someone who stops
  // half-way is followed up, not built for. After that the flag is the
  // dashboard's and the agent's to move.
  if ((kv.bookedAt || kv.answersComplete) && !rec.demoQueuedAt) {
    rec.demoQueuedAt = new Date().toISOString();
    rec.stageHistory.push({ stage: rec.stage, date: today, note: kv.bookedAt ? 'clicked Book your call — demo build queued' : 'sent their answers — demo build queued' });
    rec.demoRequested = true;
  }
  return rec;
}

async function syncToPipeline(env, email, what) {
  if (!env.PIPELINE_REPO || !env.PIPELINE_TOKEN) return;
  let why;
  try { why = await syncToPipelineOnce(env, email, what); }
  catch (e) { why = e && e.message ? e.message : String(e); }
  if (!why) return;
  // Never silent: the client saw "ok", the record is safe in KV, but the
  // dashboard did not get it — someone has to know.
  console.error('pipeline sync FAILED:', why, email);
  await sendTeamEmail(env, `Website Pipeline: dashboard sync FAILED — ${email}`,
    `The Website Build Platform did not receive this update (${what}): ${why}.
Their record is intact in KV; the dashboard is missing it until the next event for them or a resync.
If this keeps happening, check the PIPELINE_TOKEN (expired? revoked?) and the repo.`);
}

/** One attempt; returns '' on success or a short reason. Throws are caught above. */
async function syncToPipelineOnce(env, email, what) {
  const kv = await env.CLIENTS.get(`lead:${email}`, 'json');
  if (!kv) return '';
  const slug = pipelineSlug(email);
  if (!slug) return 'empty slug';
  const api = `https://api.github.com/repos/${env.PIPELINE_REPO}/contents/clients/${slug}.json`;
  const headers = ghHeaders(env);
  // ponytail: read-modify-write on the file's sha with one retry, which covers
  // a sign-up and its first answers overlapping. Put a queue in front if
  // conflicts ever become routine.
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await fetch(api, { headers });
    let file = null, sha;
    if (got.status === 200) {
      const j = await got.json();
      sha = j.sha;
      try { file = JSON.parse(b64decode(j.content)); } catch (e) { return `the file in the repo is not valid JSON (${slug}.json)`; }
      // Two different emails can map to one slug (dots, dashes and plus signs
      // all become hyphens). Never let one client overwrite another.
      if (file && file.email && file.email !== kv.email) return `slug ${slug} already belongs to ${file.email}`;
    } else if (got.status === 404 && what !== 'signed up' && await leftThePlatform(env, kv.email)) {
      return ''; // archived: never recreate from a late answer
    } else if (got.status !== 404) {
      return `GitHub read ${got.status}` + (got.status === 401 || got.status === 403 ? ' (token rejected)' : '');
    }
    const rec = projectToPipeline(kv, file, slug);
    const put = await fetch(api, {
      method: 'PUT', headers,
      body: JSON.stringify({
        message: `funnel: ${rec.org} — ${what}`,
        content: b64encode(JSON.stringify(rec, null, 2) + '\n'),
        sha,
      }),
    });
    if (put.status === 200 || put.status === 201) { console.log('pipeline synced:', slug, what); return ''; }
    if (put.status !== 409) return `GitHub write ${put.status}` + (put.status === 401 || put.status === 403 ? ' (token rejected)' : '');
  }
  return 'still conflicting after a retry';
}

/** Cloudflare Turnstile, the sign-up's bot check: the page's widget hands over
    a one-use token and Cloudflare says whether a person earned it. Off until
    TURNSTILE_SECRET is set; closed (no) if Cloudflare cannot be asked. */
async function humanCheck(env, request, token) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('cf-connecting-ip') || '' }),
    });
    return (await res.json()).success === true;
  } catch (e) {
    console.error('bot check FAILED:', e && e.message ? e.message : e);
    return false;
  }
}

/** Sign-up from start.html: seed the lead record, then both destinations. */
async function handleSignup(request, env, ctx) {
  const cors = corsHeaders(env);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json(400, { error: 'too large' }, cors);
    body = JSON.parse(raw);
  } catch (e) { return json(400, { error: 'bad json' }, cors); }

  // Honeypot: the form's hidden field. A bot that fills it gets the same OK a
  // person would, and nothing is stored or sent.
  if (s(body._honey, 200)) return json(200, { ok: true }, cors);
  // Each accepted call writes to three places, so a bot must not get past here.
  if (!await humanCheck(env, request, s(body.turnstile, 4096))) return json(403, { error: 'bot check failed' }, cors);

  const email = s(body.email, 120).toLowerCase();
  if (!EMAIL.test(email)) return json(400, { error: 'email required' }, cors);
  const name = (s(body.firstName, 60) + ' ' + s(body.lastName, 60)).trim();
  // Stored as given: it is the company named in their order. Briefs and the
  // tracker fall back to the person.
  const company = s(body.organisation, 120);
  const org = company || name || email;
  const website = s(body.website, 200);
  // The gallery example they clicked through from (websites.html ?from=slug).
  // Whitelist: slugs match websites.html's g-cta links; unknown values drop.
  const inspiration = GALLERY_SITES[s(body.inspiration, 40)] || '';

  const key = `lead:${email}`;
  const existing = (await env.CLIENTS.get(key, 'json')) || { email, status: 'lead' };
  // One sign-up per email: a second one would hand over the token and let
  // anyone who knows the address rewrite the record and accept for them.
  if (existing.token) {
    if (s(body.token, 100) !== existing.token) return json(409, { error: 'already signed up' }, cors);
    return json(200, { ok: true, token: existing.token, order: orderOf(existing) }, cors);
  }
  existing.name = name || existing.name || '';
  existing.org = company || existing.org || '';
  existing.website = website || existing.website || '';
  existing.inspiration = inspiration || existing.inspiration || '';
  existing.signedUpAt = existing.signedUpAt || new Date().toISOString();
  // The browser keeps this and sends it with the answers, so knowing someone's
  // email is not enough to rewrite their record.
  existing.token = existing.token || crypto.randomUUID();
  existing.reference = existing.reference || await newReference(env, email);
  await env.CLIENTS.put(key, JSON.stringify(existing));

  // Both destinations, independent: one failing must not stop the other. No
  // team email here: the acceptance brief follows within moments (Robbie, 27
  // Oct 2026: two emails in quick succession), and the tracker pings Slack.
  ctx.waitUntil(Promise.allSettled([
    postToLeadTracker(env, {
      org, contact: name || email, email, website, reference: existing.reference,
      source: 'website funnel', event: 'signed-up',
      message: `Signed up on the website (reference ${existing.reference}) — next, reviewing and accepting the terms.`
        + (inspiration ? ' Came in from the ' + inspiration + ' example in the gallery — a steer for the concepts.' : ''),
    }),
    syncToPipeline(env, email, 'signed up'),
  ]));

  return json(200, { ok: true, token: existing.token, order: orderOf(existing) }, cors);
}

/** The client accepts the terms at the end of sign-up. The agreement is formed
    here, so this records exactly what they saw: the order details and the
    terms version. Both boxes must be ticked; the page cannot skip either. */
async function handleAccept(request, env, ctx) {
  const cors = corsHeaders(env);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json(400, { error: 'too large' }, cors);
    body = JSON.parse(raw);
  } catch (e) { return json(400, { error: 'bad json' }, cors); }

  const email = s(body.email, 120).toLowerCase();
  const key = `lead:${email}`;
  const kv = EMAIL.test(email) ? await env.CLIENTS.get(key, 'json') : null;
  if (!kv || !kv.token) return json(404, { error: 'sign up first' }, cors);
  if (s(body.token, 100) !== kv.token) return json(403, { error: 'not the browser that signed up' }, cors);
  // Accepting twice changes nothing and sends nothing again: someone back from
  // Stripe without paying just gets a fresh payment page.
  if (kv.acceptance) return kv.payment ? json(200, { ok: true, paid: true }, cors) : payPage(env, kv, cors);
  const order = orderOf(kv);
  // The page shows the version it was given at sign-up; if that has since
  // changed, they review the new one rather than accept one they never saw.
  if (s(body.termsVersion, 20) !== order.termsVersion) return json(409, { error: 'the terms have changed', order }, cors);
  if (body.accepted !== true || body.authorised !== true) return json(400, { error: 'both boxes must be ticked' }, cors);
  if (!order.company || !order.name) return json(400, { error: 'company and name required' }, cors);

  kv.acceptance = { ...order, acceptedAt: new Date().toISOString() };
  // Evidence of acceptance with the rest; kept off the acceptance itself, which the
  // dashboard copies, so the address never leaves the worker.
  kv.acceptanceIp = s(request.headers.get('cf-connecting-ip'), 64);
  await env.CLIENTS.put(key, JSON.stringify(kv));
  const acc = kv.acceptance;

  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: terms accepted — ${acc.company}`,
      `${acc.name} accepted the ${TERMS.name}, version ${acc.termsVersion}, for ${acc.company}.

${orderText(acc)}
Accepted: ${ukTime(acc.acceptedAt)} (UK time)
Website: ${kv.website || 'none given'}${kv.inspiration ? '\nCame in from the ' + kv.inspiration + ' example in the gallery.' : ''}

They pay the £${acc.downpayment} downpayment (including VAT) next, on Stripe's payment page. A brief follows when it lands, and their confirmation email goes then. £${acc.completion} (including VAT) follows on completion.
Their questions come after paying; a brief follows when they answer.`),
    postToLeadTracker(env, {
      org: acc.company, contact: acc.name, email, website: kv.website || '', reference: acc.reference,
      source: 'website funnel', event: 'accepted',
      message: `Accepted the ${TERMS.name}, version ${acc.termsVersion} (reference ${acc.reference}). `
        + `Build fee £${acc.downpayment} downpayment + £${acc.completion} upon completion, including VAT: the downpayment is paid next, through Stripe. `
        + `Care plan £${acc.carePlan} per month including VAT from the month after the site goes live.`,
    }),
    syncToPipeline(env, email, 'accepted the terms'),
  ]));

  return payPage(env, kv, cors);
}

async function handleAnswers(request, env, ctx) {
  const cors = corsHeaders(env);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 32768) return json(400, { error: 'too large' }, cors);
    body = JSON.parse(raw);
  } catch (e) { return json(400, { error: 'bad json' }, cors); }

  const kind = body.kind === 'complete' ? 'complete' : 'partial';
  // 'update': answers the questions page saves by itself as a prospect
  // leaves. They go to the dashboard only, so the team can see who stopped
  // where; no team email.
  const quiet = body.kind === 'update';
  const email = s(body.email, 120).toLowerCase();
  if (!EMAIL.test(email)) return json(400, { error: 'email required' }, cors);

  const answers = {};
  if (body.answers && typeof body.answers === 'object') {
    for (const k of Object.keys(body.answers).slice(0, 40)) {
      const v = body.answers[k];
      answers[s(k, 40)] = Array.isArray(v) ? v.slice(0, 20).map(x => s(x, 200)) : s(v, 4000);
    }
  }

  // ponytail: KV read-modify-write without a lock — fine at funnel volume,
  // move to Durable Objects if two devices ever race on one record.
  const key = `lead:${email}`;
  const stored = await env.CLIENTS.get(key, 'json');
  // An archived client may still have the questions page open; a late answer
  // must not bring their record back.
  if (!stored && await leftThePlatform(env, email)) return json(200, { ok: true }, cors);
  // Answers belong to a client who signed up, accepted the terms and paid (the
  // page only opens the questions after all three). A page saving by itself is
  // ignored; a booking or a send is told to finish signing up.
  if (!stored || !stored.acceptance || !stored.payment) return quiet ? json(200, { ok: true }, cors) : json(409, { error: 'finish signing up first' }, cors);
  const existing = stored;
  if (s(body.token, 100) !== existing.token) {
    return json(403, { error: 'not the browser that signed up' }, cors);
  }
  const merged = { ...(existing.answers || {}), ...answers };
  const changed = JSON.stringify(merged) !== JSON.stringify(existing.answers || {});
  existing.answers = merged;
  if (changed || !existing.answersUpdatedAt) existing.answersUpdatedAt = new Date().toISOString();
  if (kind === 'complete') existing.answersComplete = true;
  // 'partial' is sent once, by the "Book your call" click.
  if (body.kind === 'partial' && !existing.bookedAt) existing.bookedAt = new Date().toISOString();
  await env.CLIENTS.put(key, JSON.stringify(existing));

  const summary = answersBrief(existing.answers);

  ctx.waitUntil(Promise.allSettled([
    quiet ? null : sendTeamEmail(env,
      `Website Pipeline: call prep answers (${kind}) — ${email}`,
      summary),
    syncToPipeline(env, email, quiet ? 'answers (saved on leaving)' : `answers (${kind})`),
  ]));

  return json(200, { ok: true }, cors);
}

/** Where a client is in the steps, for the questions page: it opens the
    questions and the booking only once they have paid, and the booking link
    comes from here, so it reaches nobody who has not paid. Straight back from
    Stripe the page sends the Checkout Session's id, and Stripe's own answer
    records the payment there and then, so the client never waits for the
    webhook; the webhook still sends the emails and the tracker note. */
async function handleStatus(request, env) {
  const cors = corsHeaders(env);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json(400, { error: 'too large' }, cors);
    body = JSON.parse(raw);
  } catch (e) { return json(400, { error: 'bad json' }, cors); }
  const email = s(body.email, 120).toLowerCase();
  const kv = EMAIL.test(email) ? await env.CLIENTS.get(`lead:${email}`, 'json') : null;
  if (!kv || !kv.token) return json(404, { error: 'sign up first' }, cors);
  if (s(body.token, 100) !== kv.token) return json(403, { error: 'not the browser that signed up' }, cors);
  if (!kv.payment && kv.acceptance && body.session) {
    const o = await fetchPaidSession(env, s(body.session, 100));
    if (o && o.client_reference_id === kv.acceptance.reference) {
      kv.payment = paymentOf(o);
      await env.CLIENTS.put(`lead:${email}`, JSON.stringify(kv));
    }
  }
  const paid = !!kv.payment;
  return json(200, { ok: true, accepted: !!kv.acceptance, paid, ...(paid ? { booking: env.BOOKING_URL } : {}) }, cors);
}

/* ── The downpayment ─────────────────────────────────────────────────────
   Accepting answers with a Stripe Checkout page made for the order, so the
   client's reference rides along. Stripe posts each completed Checkout here,
   signed with STRIPE_WEBHOOK_SECRET; only pages marked with FUNNEL are ours. */

const FUNNEL = 'website-build';

/** The client's payment page. The price (the downpayment) and its VAT rate are
    set up once in Stripe's dashboard; this only points at them, which is why the
    restricted key needs nothing beyond creating Checkout Sessions. */
async function checkoutUrl(env, kv) {
  const acc = kv.acceptance;
  const p = {
    mode: 'payment',
    'line_items[0][price]': env.STRIPE_PRICE,
    'line_items[0][quantity]': '1',
    customer_email: kv.email,
    client_reference_id: acc.reference,
    'metadata[funnel]': FUNNEL,
    'custom_text[submit][message]': `${acc.company}: upfront payment towards your website build fee (${acc.reference}).`,
    'invoice_creation[enabled]': 'true',
    'invoice_creation[invoice_data][custom_fields][0][name]': 'Reference',
    'invoice_creation[invoice_data][custom_fields][0][value]': acc.reference,
    // Stripe fills in the session id, which the questions page hands to /status.
    success_url: `${env.SITE_URL}/questions?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL}/start`,
  };
  if (env.STRIPE_TAX_RATE) p['line_items[0][tax_rates][0]'] = env.STRIPE_TAX_RATE;
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_API_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(p).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(`Stripe ${res.status}${body.error ? ' — ' + body.error.message : ''}`);
  return body.url;
}

/** The acceptance stands either way; a page Stripe would not make is retried by the client. */
async function payPage(env, kv, cors) {
  try { return json(200, { ok: true, pay: await checkoutUrl(env, kv) }, cors); }
  catch (e) {
    console.error('payment page FAILED:', e && e.message ? e.message : e, kv.email);
    return json(502, { error: 'payment page unavailable' }, cors);
  }
}

/** One of our Checkout Sessions, if Stripe says it is paid; null otherwise or
    if Stripe cannot be asked (the page then waits for the webhook instead). */
async function fetchPaidSession(env, id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
      headers: { authorization: `Bearer ${env.STRIPE_API_KEY}` },
    });
    const o = await res.json();
    if (!res.ok) throw new Error(`Stripe ${res.status}${o.error ? ' — ' + o.error.message : ''}`);
    return o.payment_status === 'paid' && o.metadata && o.metadata.funnel === FUNNEL ? o : null;
  } catch (e) {
    console.error('payment check FAILED:', e && e.message ? e.message : e, id);
    return null;
  }
}

const paymentOf = o => ({ id: s(o.id, 100), amount: o.amount_total, currency: s(o.currency, 10), paidAt: new Date().toISOString() });

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Stripe signature: header "t=...,v1=..."; v1 = HMAC-SHA256(secret, `${t}.${body}`). */
async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.create(null);
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=');
    (parts[k] = parts[k] || []).push(v);
  }
  const t = parts.t && parts.t[0];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return (parts.v1 || []).some(v => v === expected);
}

const money = (amount, currency) => (currency || 'gbp').toLowerCase() === 'gbp'
  ? `£${((amount || 0) / 100).toFixed(2).replace(/\.00$/, '')}`
  : `${(amount || 0) / 100} ${String(currency).toUpperCase()}`;

async function handleStripeWebhook(request, env, ctx) {
  const rawBody = await request.text();
  if (!await verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) {
    return json(400, { error: 'bad signature' });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return json(400, { error: 'bad payload' }); }
  // Only a paid Checkout from a page this worker made concerns the funnel. Every
  // other payment on the account (the final payment, other work) is outside this
  // project; payment_intent.succeeded for our own pages repeats what this says.
  const o = (event.data && event.data.object) || {};
  if (event.type !== 'checkout.session.completed' || o.payment_status !== 'paid' || !o.metadata || o.metadata.funnel !== FUNNEL) {
    return json(200, { received: true, ignored: event.type });
  }

  // Stripe retries: record each payment once.
  const seen = `stripe:${s(o.id, 100)}`;
  if (await env.CLIENTS.get(seen)) return json(200, { received: true, duplicate: true });
  const ref = s(o.client_reference_id, 40);
  await env.CLIENTS.put(seen, ref);
  const paid = money(o.amount_total, o.currency);
  const email = await env.CLIENTS.get(`ref:${ref}`);
  const key = `lead:${email}`;
  const kv = email ? await env.CLIENTS.get(key, 'json') : null;

  // Money in must never pass silently, even when the record has gone (archived)
  // or the client paid on two pages at once. The same payment, already recorded
  // by the questions page (/status), is not a second one.
  if (!kv || !kv.acceptance || (kv.payment && kv.payment.id !== o.id)) {
    ctx.waitUntil(sendTeamEmail(env, `Website Pipeline: payment needs a look — ${ref || 'no reference'}`,
      `${paid} arrived for ${ref || 'no reference'} (Stripe ${o.id}), ${kv && kv.payment ? `but that order was already paid (Stripe ${kv.payment.id}): refund one of them in Stripe` : 'but it matches no order waiting for payment: match it by hand in Stripe and the Lead Tracker'}.`));
    return json(200, { received: true, unmatched: true });
  }

  if (!kv.payment) {
    kv.payment = paymentOf(o);
    await env.CLIENTS.put(key, JSON.stringify(kv));
  }
  const acc = kv.acceptance;

  ctx.waitUntil(Promise.allSettled([
    sendConfirmation(env, acc),
    sendTeamEmail(env, `Website Pipeline: paid — ${acc.company}`,
      `${acc.name} (${acc.company}, reference ${acc.reference}) paid ${paid}. Their confirmation email has gone, with the terms attached. Next they answer the questions and book their call.
Stripe: ${o.id}`),
    postToLeadTracker(env, {
      org: acc.company, contact: acc.name, email, reference: acc.reference,
      source: 'website funnel', event: 'paid', message: `Paid ${paid} via Stripe (${o.id}).`,
    }),
  ]));
  return json(200, { received: true });
}

/* ── Archived clients ────────────────────────────────────────────────────
   The dashboard archives a client once their call is held or they declined:
   it deletes their files from the platform repo, appends a line to
   history/clients.jsonl and deletes this worker's KV record. This worker's
   only part is not bringing them back: a late answer from their open
   questions page must not recreate the record. */

const HISTORY = 'history/clients.jsonl';
const ghHeaders = env => ({
  authorization: `Bearer ${env.PIPELINE_TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'iternal-funnel-worker',
  'content-type': 'application/json',
});

/** Whether this email belongs to a client the dashboard has archived. */
async function leftThePlatform(env, email) {
  if (!env.PIPELINE_REPO || !env.PIPELINE_TOKEN) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.PIPELINE_REPO}/contents/${HISTORY}`, { headers: ghHeaders(env) });
    if (!res.ok) return false;
    return b64decode((await res.json()).content).split('\n').some(l => { try { return JSON.parse(l).email === email; } catch (e) { return false; } });
  } catch (e) { return false; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/signup' && request.method === 'POST') return handleSignup(request, env, ctx);
    if (url.pathname === '/accept' && request.method === 'POST') return handleAccept(request, env, ctx);
    if (url.pathname === '/answers' && request.method === 'POST') return handleAnswers(request, env, ctx);
    if (url.pathname === '/status' && request.method === 'POST') return handleStatus(request, env);
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env, ctx);
    return json(404, { error: 'not found' });
  },
};
