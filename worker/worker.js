/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Flow (pay-at-booking): the client agrees the terms on start.html, answers
 * the questions, then books their call on the Google Calendar appointment
 * page — which takes the £375 (Google's Stripe integration) and only
 * confirms the booking when payment succeeds.
 *
 * Routes:
 *   POST /stripe-webhook  Stripe calls this when money moves. The pay-at-
 *                         booking flow arrives as payment_intent.succeeded
 *                         (from Google Calendar's Stripe integration): the
 *                         payer's lead record is upgraded to a paid client,
 *                         the team gets a brief, and the Lead Tracker gets
 *                         a Landed entry. checkout.session.completed is
 *                         kept for the legacy Payment Link until it is
 *                         deactivated.
 *   POST /signup          The start.html form posts here after sign-up:
 *                         seeds their lead record in KV and carries the
 *                         sign-up into the Lead Tracker pipeline
 *                         (fire-and-forget, never blocking).
 *   POST /answers         The questions page posts drafts/finals here, keyed
 *                         by the email they give in the first question.
 *                         Answers land on their lead record (or client
 *                         record once they've paid) so nothing is lost.
 *   GET  /health          Liveness check.
 *
 * Clients get NO email from us by design: Stripe sends the receipt, Google
 * Calendar sends the booking invite. Team briefs go via Cloudflare's native
 * email (send_email binding) to a verified destination.
 *
 * Explicitly NOT here: card details (Stripe's), booking (Google Calendar's),
 * and any READ of the Lead Tracker (write-only by policy).
 *
 * Secrets (wrangler secret put): STRIPE_WEBHOOK_SECRET, LEAD_API_SECRET.
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
  const to = env.TEAM_EMAIL;
  const raw = 'From: ' + from + '\r\n' + 'To: ' + to + '\r\n' +
    'Subject: ' + subject + '\r\n' + 'Date: ' + new Date().toUTCString() + '\r\n' +
    'Content-Type: text/plain; charset=utf-8' + '\r\n\r\n' + text;
  // The envelope wants bare addresses; the display name lives in the MIME From.
  const bare = a => { const m = /<([^>]+)>/.exec(a); return m ? m[1] : a; };
  let msg = { from, to, raw };
  // In the Workers runtime this import exists; in the Node self-check it
  // throws and the stub binding receives the plain object instead.
  try { const { EmailMessage } = await import('cloudflare:email'); msg = new EmailMessage(bare(from), bare(to), raw); } catch (e) {}
  try {
    await env.TEAM_MAIL.send(msg);
    console.log('team brief sent:', subject);
  } catch (e) {
    console.error('team brief FAILED:', e && e.message ? e.message : e);
    throw e;
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

/* Field ids as sent by questions.html, in the order they appear on the page.
   Keeps team briefs readable as real Q&A; unknown ids fall back to the raw key. */
const QUESTIONS = [
  ['email', 'Your work email'],
  ['mainJob', "What's the site's main job?"],
  ['hasSite', 'Do you have a website today?'],
  ['audience', 'Who do you most want the site to reach?'],
  ['timeline', 'When would you like to launch?'],
  ['mustDo', "When someone visits, what's the one thing you'd like them to do?"],
  ['pages', 'Which pages do you think you need?'],
  ['branding', 'Do you have branding — a logo, colours?'],
  ['visualStyle', 'Which look pulls you more?'],
  ['feel', 'When someone they respect sees the finished site, what should they think?'],
  ['admired', 'Which of our sites do you like the look of?'],
  ['peers', 'Competitors or peers — doing well / getting wrong'],
  ['dislikes', 'Any sites that make you cringe?'],
  ['content', 'Where will the words come from?'],
  ['assets', 'What do you already have that we can use?'],
  ['wrong', 'If you have a site now — what does it get wrong?'],
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
  const existing = (await env.CLIENTS.get(key, 'json')) || {};
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
  // The payment redirect carries ?session={CHECKOUT_SESSION_ID}; this mapping
  // lets /answers attach those answers to the paying client's record.
  if (record.stripeSession) await env.CLIENTS.put(`session:${record.stripeSession}`, email);

  ctx.waitUntil(Promise.allSettled([
    sendTeamEmail(env,
      `Website Pipeline: ${email} paid`,
      `${name || email} paid ${(session.amount_total || 0) / 100} ${(session.currency || 'gbp').toUpperCase()}.
Stripe session: ${session.id}
They've been redirected to the questions.`),
    postToLeadTracker(env, {
      org: name || email, email,
      source: 'website funnel', message: 'Paid £375 via Stripe — awaiting questions.',
    }),
  ]));

  return json(200, { received: true });
}

/**
 * A payment landed via Google Calendar's pay-at-booking (or any direct
 * PaymentIntent). Match the payer by email, upgrade their lead record to a
 * paid client, brief the team, post the Landed entry to the tracker. If no
 * email is on the event, brief the team anyway — a payment must never pass
 * silently.
 */
async function handlePaymentIntent(event, env, ctx) {
  const pi = (event.data && event.data.object) || {};
  const email = s(pi.receipt_email || (pi.charges && pi.charges.data && pi.charges.data[0] &&
    pi.charges.data[0].billing_details && pi.charges.data[0].billing_details.email) || '', 120).toLowerCase();
  const amount = pi.amount_received || pi.amount || 0;

  if (!email) {
    ctx.waitUntil(sendTeamEmail(env,
      'Website Pipeline: payment received — UNMATCHED',
      `A payment of ${amount / 100} ${(pi.currency || 'gbp').toUpperCase()} arrived (${pi.id}) with no payer email on the event. Match it by hand in Stripe.`));
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
      `Website Pipeline: ${email} booked & paid`,
      `${email} paid ${amount / 100} ${(pi.currency || 'gbp').toUpperCase()} at booking — the call is confirmed.
Payment: ${pi.id}${record.answersComplete ? '\nTheir call-prep answers are already in.' : '\nTheir answers so far are on the record; more may follow.'}`),
    postToLeadTracker(env, {
      org: email, email,
      source: 'website funnel', message: 'Booked the call and paid £375 — call confirmed.',
    }),
  ]));

  return json(200, { received: true });
}

/** Sign-up from start.html: seed the lead record, carry it to the tracker. */
async function handleSignup(request, env, ctx) {
  const cors = corsHeaders(env);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json(400, { error: 'too large' }, cors);
    body = JSON.parse(raw);
  } catch (e) { return json(400, { error: 'bad json' }, cors); }

  const email = s(body.email, 120).toLowerCase();
  if (!email || email.indexOf('@') === -1) return json(400, { error: 'email required' }, cors);
  const name = (s(body.firstName, 60) + ' ' + s(body.lastName, 60)).trim();
  const org = s(body.organisation, 120) || name || email;
  const website = s(body.website, 200);

  const key = `lead:${email}`;
  const existing = (await env.CLIENTS.get(key, 'json')) || { email, status: 'lead' };
  existing.name = name || existing.name || '';
  existing.org = org || existing.org || '';
  existing.website = website || existing.website || '';
  existing.signedUpAt = existing.signedUpAt || new Date().toISOString();
  await env.CLIENTS.put(key, JSON.stringify(existing));

  ctx.waitUntil(postToLeadTracker(env, {
    org, contact: name || email, email, website,
    source: 'website funnel', message: 'Signed up on the website — heading into the project questions.',
  }));

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
  // Answers land on the client record if they've already paid (pay-at-booking
  // can complete before the final answers arrive), else on their lead record.
  const paidClient = await env.CLIENTS.get(`client:${email}`, 'json');
  const key = (sessionEmail || paidClient) ? `client:${email}` : `lead:${email}`;
  const existing = paidClient || (await env.CLIENTS.get(key, 'json')) || { email, status: sessionEmail ? 'paid' : 'lead' };
  existing.answers = { ...(existing.answers || {}), ...answers };
  existing.answersUpdatedAt = new Date().toISOString();
  if (kind === 'complete') existing.answersComplete = true;
  await env.CLIENTS.put(key, JSON.stringify(existing));

  const summary = answersBrief(existing.answers);

  ctx.waitUntil(sendTeamEmail(env,
    `Website Pipeline: call prep answers (${kind}) — ${email}`,
    `${existing.status === 'paid' ? 'Booked & paid client' : 'Not yet booked — answers ahead of the call booking'}.

${summary}`));

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
