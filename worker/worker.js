/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Flow: the client signs up and agrees the terms on start.html, answers the
 * questions, then books their call on the Google Calendar appointment page.
 * Booking takes NO payment; the deposit is handled separately by the team.
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
 *   POST /answers         The questions page posts drafts/finals here, keyed
 *                         by the email they give in the first question. The
 *                         first answers queue the pre-call demo build
 *                         (demoRequested) in the pipeline repo.
 *   POST /stripe-webhook  Stripe calls this when money moves (a payment the
 *                         team requested separately): the payer's record is
 *                         marked paid in KV and the tracker, and the team
 *                         is briefed. Payment never touches the platform
 *                         record: that lives in the tracker.
 *   GET  /health          Liveness check.
 *
 * Clients get NO email from us by design: Stripe sends any receipt, Google
 * Calendar sends the booking invite. Team briefs go via Cloudflare's native
 * email (send_email binding) to verified destinations.
 *
 * Explicitly NOT here: card details (Stripe's), booking (Google Calendar's),
 * and any READ of the Lead Tracker (write-only by policy).
 *
 * Secrets (wrangler secret put): STRIPE_WEBHOOK_SECRET, LEAD_API_SECRET,
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

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
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
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lead),
  });
}

const s = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);

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
  ['feel', 'When someone they respect sees the finished site, what should they think?'],
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

/* The worker owns the fields it sets here and refreshes them from KV on every
   event. Everything else in the file (stageHistory notes, demo, research,
   notes, a cleared demoRequested) belongs to the dashboard and the agents and
   is carried over untouched. */
function projectToPipeline(kv, file, slug) {
  const today = new Date().toISOString().slice(0, 10);
  const rec = file || {
    slug, stage: 'signed-up',
    stageHistory: [{ stage: 'signed-up', date: today, note: 'signed up on the website' }],
    demoRequested: false, demo: null, research: '', notes: '', answersFirstAt: null,
  };
  const raw = kv.answers || {};
  const labels = new Map(QUESTIONS);
  const prev = new Map((rec.answers || []).map(a => [a.id, a]));
  // Every question, in page order, answered or not (answer: null) — so the
  // dashboard can fill in what a client skipped without its own copy of the
  // question list. Then anything outside the map, from either side.
  const ids = [...new Set([...labels.keys(), ...Object.keys(raw), ...prev.keys()])]
    .filter(k => k !== 'termsAgreed');
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  rec.email = kv.email;
  rec.contact = kv.name || '';
  rec.org = kv.org || kv.name || kv.email;
  rec.website = kv.website || '';
  rec.inspiration = kv.inspiration || '';
  rec.signedUpAt = kv.signedUpAt || rec.signedUpAt || null;
  rec.termsAgreedAt = raw.termsAgreed || rec.termsAgreedAt || null;
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
  // Payment is deliberately NOT on this record: the platform is for demo
  // building; whether a client has paid lives in the Lead Tracker.

  // The first answers queue the pre-call demo build, once (the essentials are
  // mandatory before booking, so this is part of signing up, not a stage of
  // its own). After that the flag is the dashboard's and the agent's to move.
  const answered = Object.keys(raw).some(id => id !== 'email' && id !== 'termsAgreed');
  if (answered && !rec.answersFirstAt) {
    rec.answersFirstAt = kv.answersUpdatedAt || new Date().toISOString();
    rec.stageHistory.push({ stage: rec.stage, date: today, note: 'answers arrived — demo build queued' });
    rec.demoRequested = true;
  }
  return rec;
}

async function syncToPipeline(env, email, what) {
  if (!env.PIPELINE_REPO || !env.PIPELINE_TOKEN) return;
  const kv = (await env.CLIENTS.get(`client:${email}`, 'json')) || (await env.CLIENTS.get(`lead:${email}`, 'json'));
  if (!kv) return;
  const slug = pipelineSlug(email);
  const api = `https://api.github.com/repos/${env.PIPELINE_REPO}/contents/clients/${slug}.json`;
  const headers = {
    authorization: `Bearer ${env.PIPELINE_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'iternal-funnel-worker',
    'content-type': 'application/json',
  };
  // ponytail: read-modify-write on the file's sha with one retry, which covers
  // a sign-up and its first answers overlapping. Put a queue in front if
  // conflicts ever become routine.
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await fetch(api, { headers });
    let file = null, sha;
    if (got.status === 200) {
      const j = await got.json();
      sha = j.sha;
      file = JSON.parse(b64decode(j.content));
    } else if (got.status !== 404) {
      console.error('pipeline read FAILED:', got.status, slug);
      return;
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
    if (put.status === 200 || put.status === 201) { console.log('pipeline synced:', slug, what); return; }
    if (put.status !== 409) { console.error('pipeline write FAILED:', put.status, slug); return; }
  }
  console.error('pipeline write FAILED: still conflicting after retry', slug);
}

const money = (amount, currency) => `${(amount || 0) / 100} ${(currency || 'gbp').toUpperCase()}`;

async function handleStripeWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const ok = await verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json(400, { error: 'bad signature' });

  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return json(400, { error: 'bad payload' }); }
  if (event.type === 'payment_intent.succeeded') return handlePaymentIntent(event, env, ctx);
  if (event.type !== 'checkout.session.completed') return json(200, { received: true, ignored: event.type });

  const session = (event.data && event.data.object) || {};
  const details = session.customer_details || {};
  const email = s(details.email, 120).toLowerCase();
  if (!email) return json(200, { received: true, ignored: 'no email' });
  const name = s(details.name, 120);

  const key = `client:${email}`;
  const lead = await env.CLIENTS.get(`lead:${email}`, 'json');
  const existing = (await env.CLIENTS.get(key, 'json')) || lead || {};
  const record = {
    ...existing,
    email, name: name || existing.name || '',
    status: 'paid',
    paidAt: new Date().toISOString(),
    amount: session.amount_total,
    stripeSession: s(session.id, 100),
    answers: existing.answers || {},
  };
  await env.CLIENTS.put(key, JSON.stringify(record));
  if (lead) await env.CLIENTS.delete(`lead:${email}`); // their sign-up and answers now live on the client record
  // The payment redirect carries ?session={CHECKOUT_SESSION_ID}; this mapping
  // lets /answers attach those answers to the paying client's record.
  if (record.stripeSession) await env.CLIENTS.put(`session:${record.stripeSession}`, email);

  const paid = money(session.amount_total, session.currency);
  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: ${email} paid`,
      `${name || email} paid ${paid}.
Stripe session: ${session.id}`),
    postToLeadTracker(env, {
      org: name || email, email,
      source: 'website funnel', message: `Payment received (${paid}) via Stripe.`,
    }),
  ]));

  return json(200, { received: true });
}

/**
 * A payment the team requested separately landed (any direct PaymentIntent).
 * Match the payer by email, mark their record paid, brief the team, update
 * both destinations. If no email is on the event, brief the team anyway — a
 * payment must never pass silently.
 */
async function handlePaymentIntent(event, env, ctx) {
  const pi = (event.data && event.data.object) || {};
  const email = s(pi.receipt_email || (pi.charges && pi.charges.data && pi.charges.data[0] &&
    pi.charges.data[0].billing_details && pi.charges.data[0].billing_details.email) || '', 120).toLowerCase();
  const amount = pi.amount_received || pi.amount || 0;

  const paid = money(amount, pi.currency);

  if (!email) {
    ctx.waitUntil(sendTeamEmail(env,
      'Website Pipeline: payment received — UNMATCHED',
      `A payment of ${paid} arrived (${pi.id}) with no payer email on the event. Match it by hand in Stripe.`));
    return json(200, { received: true, unmatched: true });
  }

  const lead = await env.CLIENTS.get(`lead:${email}`, 'json');
  const existing = (await env.CLIENTS.get(`client:${email}`, 'json')) || lead || {};
  const record = {
    ...existing,
    email,
    status: 'paid',
    paidAt: new Date().toISOString(),
    amount,
    paymentIntent: s(pi.id, 100),
    answers: existing.answers || {},
  };
  await env.CLIENTS.put(`client:${email}`, JSON.stringify(record));
  if (lead) await env.CLIENTS.delete(`lead:${email}`);

  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: payment received — ${email}`,
      `${email} paid ${paid}.
Payment: ${pi.id}${record.answersComplete ? '\nTheir call-prep answers are already in.' : '\nTheir answers so far are on the record; more may follow.'}`),
    postToLeadTracker(env, {
      org: email, email,
      source: 'website funnel', message: `Payment received (${paid}) via Stripe.`,
    }),
  ]));

  return json(200, { received: true });
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
  if (!email || email.indexOf('@') === -1) return json(400, { error: 'email required' }, cors);
  const name = (s(body.firstName, 60) + ' ' + s(body.lastName, 60)).trim();
  const org = s(body.organisation, 120) || name || email;
  const website = s(body.website, 200);
  // The gallery example they clicked through from (websites.html ?from=slug).
  // Whitelist: slugs match websites.html's g-cta links; unknown values drop.
  const inspiration = GALLERY_SITES[s(body.inspiration, 40)] || '';

  const key = `lead:${email}`;
  const existing = (await env.CLIENTS.get(key, 'json')) || { email, status: 'lead' };
  existing.name = name || existing.name || '';
  existing.org = org || existing.org || '';
  existing.website = website || existing.website || '';
  existing.inspiration = inspiration || existing.inspiration || '';
  existing.signedUpAt = existing.signedUpAt || new Date().toISOString();
  await env.CLIENTS.put(key, JSON.stringify(existing));

  // Two destinations plus the team brief, all independent: one failing must
  // not stop the others.
  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: new sign-up — ${org}`,
      `${name || email} signed up for a website build.

Email: ${email}
Organisation: ${org}
Website: ${website || 'none given'}${inspiration ? '\nCame in from the ' + inspiration + ' example in the gallery.' : ''}

Their questions come next; a second brief follows when they answer.`),
    postToLeadTracker(env, {
      org, contact: name || email, email, website,
      source: 'website funnel',
      message: 'Signed up on the website — heading into the project questions.'
        + (inspiration ? ' Came in from the ' + inspiration + ' example in the gallery — a steer for the concepts.' : ''),
    }),
    syncToPipeline(env, email, 'signed up'),
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
  const sessionId = s(body.session, 100);
  const sessionEmail = sessionId ? await env.CLIENTS.get(`session:${sessionId}`) : null;
  const email = ((sessionEmail || s(body.email, 120)) + '').toLowerCase();
  if (!email || email.indexOf('@') === -1) return json(400, { error: 'email required' }, cors);

  const answers = {};
  if (body.answers && typeof body.answers === 'object') {
    for (const k of Object.keys(body.answers).slice(0, 40)) {
      const v = body.answers[k];
      answers[s(k, 40)] = Array.isArray(v) ? v.slice(0, 20).map(x => s(x, 200)) : s(v, 4000);
    }
  }

  // ponytail: KV read-modify-write without a lock — fine at funnel volume,
  // move to Durable Objects if two devices ever race on one record.
  // Answers land on the client record if they've already paid (a payment can
  // arrive before the final answers do), else on their lead record.
  const paidClient = await env.CLIENTS.get(`client:${email}`, 'json');
  const key = (sessionEmail || paidClient) ? `client:${email}` : `lead:${email}`;
  const existing = paidClient || (await env.CLIENTS.get(key, 'json')) || { email, status: sessionEmail ? 'paid' : 'lead' };
  existing.answers = { ...(existing.answers || {}), ...answers };
  existing.answersUpdatedAt = new Date().toISOString();
  if (kind === 'complete') existing.answersComplete = true;
  await env.CLIENTS.put(key, JSON.stringify(existing));

  const summary = answersBrief(existing.answers);

  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: call prep answers (${kind}) — ${email}`,
      `${existing.status === 'paid' ? 'Payment received' : 'No payment recorded yet'}.

${summary}`),
    syncToPipeline(env, email, `answers (${kind})`),
  ]));

  return json(200, { ok: true }, cors);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env, ctx);
    if (url.pathname === '/signup' && request.method === 'POST') return handleSignup(request, env, ctx);
    if (url.pathname === '/answers' && request.method === 'POST') return handleAnswers(request, env, ctx);
    return json(404, { error: 'not found' });
  },
};
