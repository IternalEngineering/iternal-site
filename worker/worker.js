/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Routes:
 *   POST /stripe-webhook  Stripe calls this when the £375 payment completes.
 *                         Verifies the signature, writes the client record to
 *                         KV (plus a session→email mapping for the redirect),
 *                         briefs the team, and posts the lead into the
 *                         Lead Tracker.
 *   POST /answers         The questions page posts drafts/finals here. With a
 *                         valid Stripe session id (carried by the payment
 *                         redirect) the answers attach to the paying client's
 *                         record; without one they're stored as a plain lead
 *                         so nothing is ever lost.
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
  ['visualStyle', 'Which pulls you more? (visual direction)'],
  ['feel', 'What should someone they respect think of the finished site?'],
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
  const key = sessionEmail ? `client:${email}` : `lead:${email}`;
  const existing = (await env.CLIENTS.get(key, 'json')) || { email, status: sessionEmail ? 'paid' : 'lead' };
  existing.answers = { ...(existing.answers || {}), ...answers };
  existing.answersUpdatedAt = new Date().toISOString();
  if (kind === 'complete') existing.answersComplete = true;
  await env.CLIENTS.put(key, JSON.stringify(existing));

  const summary = answersBrief(existing.answers);

  ctx.waitUntil(sendTeamEmail(env,
    `Website Pipeline: call prep answers (${kind}) — ${email}`,
    `${sessionEmail ? 'Paying client' : 'Unpaid lead'}.

${summary}`));

  return json(200, { ok: true }, cors);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env, ctx);
    if (url.pathname === '/answers' && request.method === 'POST') return handleAnswers(request, env, ctx);
    return json(404, { error: 'not found' });
  },
};
