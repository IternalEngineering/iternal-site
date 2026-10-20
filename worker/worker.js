/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Flow: the client signs up on start.html, reviews their order and accepts
 * the Website Build and Care Terms there, answers the questions, then books
 * their call on the Google Calendar appointment page. Nothing here takes
 * payment; the team invoices.
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
 *                         Answers with the order to review.
 *   POST /accept          The client accepts the terms: records what they
 *                         accepted, emails them a copy, tells the team to
 *                         invoice, and updates both destinations.
 *   POST /answers        The questions page posts drafts/finals here, keyed
 *                         by the email they give in the first question. The
 *                         first answers queue the pre-call demo build
 *                         (demoRequested) in the pipeline repo.
 *   GET  /health          Liveness check.
 *
 * Clients get ONE email from us: on accepting, a copy of their order and the
 * terms, as the terms promise (CLIENT_MAIL, Cloudflare Email Service). Google
 * Calendar sends the booking invite. Team briefs go via Cloudflare's native
 * email (TEAM_MAIL) to verified destinations.
 *
 * Explicitly NOT here: payment (the team handles it, outside this worker),
 * booking (Google Calendar's), and any READ of the Lead Tracker (write-only
 * by policy).
 *
 * Secrets (wrangler secret put): LEAD_API_SECRET, PIPELINE_TOKEN (GitHub
 * token with contents:write on PIPELINE_REPO only).
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
    const raw = 'From: ' + from + '\r\n' + 'To: ' + to + '\r\n' +
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
// The standard order. The terms set a £750 build fee paid 50/50 "unless your order
// details state a different amount", and order details take priority over the terms,
// so the order's downpayment + completion split is what the client agrees to.
const TERMS = { name: 'Website Build and Care Terms', version: '1.0', downpayment: 100, completion: 650, carePlan: 50 };
const termsUrl = (env, version, ext) => `${env.SITE_URL}/terms/website-build-and-care-v${version}.${ext}`;

function newReference() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => abc[b % abc.length]).join('');
  return 'WB-' + new Date().toISOString().slice(2, 7).replace('-', '') + '-' + tail;
}

/** The order details as the client reviews them, from their lead record. */
const orderOf = kv => ({
  company: kv.org || '', name: kv.name || '', email: kv.email, reference: kv.reference || '',
  buildFee: TERMS.downpayment + TERMS.completion, downpayment: TERMS.downpayment, completion: TERMS.completion,
  carePlan: TERMS.carePlan, termsVersion: TERMS.version,
});

/** The order as plain-text lines, worded as on the acceptance screen. */
const orderText = o => [
  ['Company', o.company], ['Your name', o.name], ['Email', o.email], ['Reference', o.reference],
  ['Build fee', `£${o.downpayment} downpayment + £${o.completion} upon completion, plus VAT`],
  ['Care plan', `£${o.carePlan} per month + VAT, from the month after your site goes live. Payable monthly, quarterly, half-yearly or annually in advance`],
  ['Terms', `${TERMS.name}, version ${o.termsVersion}`],
].map(([k, v]) => `${k}: ${v}`).join('\n');

const ukTime = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' });

/** The copy the terms promise the client. If it cannot go, the team gets it to forward. */
async function sendClientCopy(env, acc) {
  const pdfUrl = termsUrl(env, acc.termsVersion, 'pdf');
  const text = `Hello ${acc.name.split(' ')[0]},

Thank you for accepting our terms. As promised, here are your order details. The ${TERMS.name}, version ${acc.termsVersion}, are attached, and are also at ${termsUrl(env, acc.termsVersion, 'html')}

${orderText(acc)}
Accepted: ${ukTime(acc.acceptedAt)} (UK time)

If anything above is wrong, reply to this email and let us know.

Iternal Ltd
`;
  try {
    if (!env.CLIENT_MAIL) throw new Error('no CLIENT_MAIL binding');
    const pdf = await fetch(pdfUrl);
    if (!pdf.ok) throw new Error(`terms PDF ${pdf.status}`);
    const [, fromName, fromEmail] = /^(.*?)\s*<([^>]+)>$/.exec(env.CLIENT_FROM) || [, '', env.CLIENT_FROM];
    await env.CLIENT_MAIL.send({
      to: acc.email, from: { name: fromName, email: fromEmail }, replyTo: env.CLIENT_REPLY_TO,
      subject: `Your order with Iternal, ${acc.reference}`,
      text,
      attachments: [{ content: await pdf.arrayBuffer(), filename: `Iternal ${TERMS.name} v${acc.termsVersion}.pdf`, type: 'application/pdf', disposition: 'attachment' }],
    });
    console.log('client copy sent:', acc.reference);
  } catch (e) {
    const why = e && e.message ? e.message : String(e);
    console.error('client copy FAILED:', why, acc.email);
    await sendTeamEmail(env, `Website Pipeline: client copy FAILED — ${acc.company}`,
      `${acc.name} accepted the terms, but the copy the terms promise them did not send (${why}).
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
  // ponytail: honeypot only. Add Turnstile or a rate-limit rule if this
  // endpoint ever draws real abuse — each accepted call writes to four places.
  if (s(body._honey, 200)) return json(200, { ok: true }, cors);

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
  existing.reference = existing.reference || newReference();
  await env.CLIENTS.put(key, JSON.stringify(existing));

  // Two destinations plus the team brief, all independent: one failing must
  // not stop the others.
  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: new sign-up — ${org}`,
      `${name || email} signed up for a website build.

Email: ${email}
Organisation: ${org}
Website: ${website || 'none given'}
Reference: ${existing.reference}${inspiration ? '\nCame in from the ' + inspiration + ' example in the gallery.' : ''}

Next they review their order and accept the terms; a brief follows when they do.`),
    postToLeadTracker(env, {
      org, contact: name || email, email, website,
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
  // Accepting twice changes nothing and sends nothing again.
  if (kv.acceptance) return json(200, { ok: true }, cors);
  const order = orderOf(kv);
  // The page shows the version it was given at sign-up; if that has since
  // changed, they review the new one rather than accept one they never saw.
  if (s(body.termsVersion, 20) !== order.termsVersion) return json(409, { error: 'the terms have changed', order }, cors);
  if (body.accepted !== true || body.authorised !== true) return json(400, { error: 'both boxes must be ticked' }, cors);
  if (!order.company || !order.name) return json(400, { error: 'company and name required' }, cors);

  kv.acceptance = { ...order, acceptedAt: new Date().toISOString() };
  await env.CLIENTS.put(key, JSON.stringify(kv));
  const acc = kv.acceptance;

  ctx.waitUntil(Promise.allSettled([
    sendClientCopy(env, acc),
    sendTeamEmail(env,
      `Website Pipeline: terms accepted — ${acc.company}`,
      `${acc.name} accepted the ${TERMS.name}, version ${acc.termsVersion}, for ${acc.company}.

${orderText(acc)}
Accepted: ${ukTime(acc.acceptedAt)} (UK time)

The £${acc.downpayment} downpayment (+ VAT) is payable now: send the invoice. £${acc.completion} (+ VAT) follows on completion. They have been emailed a copy of the order and the terms.
Their questions come next; a brief follows when they answer.`),
    postToLeadTracker(env, {
      org: acc.company, contact: acc.name, email, website: kv.website || '',
      source: 'website funnel', event: 'accepted',
      message: `Accepted the ${TERMS.name}, version ${acc.termsVersion} (reference ${acc.reference}). `
        + `Build fee £${acc.downpayment} downpayment + £${acc.completion} upon completion, plus VAT: invoice the downpayment. `
        + `Care plan £${acc.carePlan} per month + VAT from the month after the site goes live.`,
    }),
    syncToPipeline(env, email, 'accepted the terms'),
  ]));

  return json(200, { ok: true }, cors);
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
  // Answers belong to a client who signed up and accepted the terms (the page
  // only leads to the questions after both). A page saving by itself is
  // ignored; a booking or a send is told to finish signing up.
  if (!stored || !stored.acceptance) return quiet ? json(200, { ok: true }, cors) : json(409, { error: 'finish signing up first' }, cors);
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
    return json(404, { error: 'not found' });
  },
};
