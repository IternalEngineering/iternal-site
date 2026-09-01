/**
 * Iternal funnel worker — the funnel's only backend.
 *
 * Routes:
 *   POST /stripe-webhook  Stripe calls this when the £375 payment completes.
 *                         Verifies the signature, writes the client record to
 *                         KV, then (best-effort) emails the client their magic
 *                         link, briefs the team, and posts the lead into the
 *                         Lead Tracker.
 *   POST /answers         The questions page posts drafts/finals here.
 *                         With a valid token the answers attach to the paying
 *                         client's record; without one they're stored as a
 *                         plain lead so nothing is ever lost.
 *   GET  /health          Liveness check.
 *
 * Explicitly NOT here: card details (Stripe's), booking (Calendly's), and any
 * READ of the Lead Tracker (write-only by policy).
 *
 * Secrets (wrangler secret put): STRIPE_WEBHOOK_SECRET, MAGIC_SECRET,
 * RESEND_API_KEY, LEAD_API_SECRET. Vars in wrangler.toml.
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

const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function makeToken(email, env) {
  return b64url(email) + '.' + (await hmacHex(env.MAGIC_SECRET, email)).slice(0, 32);
}

async function emailFromToken(token, env) {
  try {
    const [payload, mac] = String(token).split('.');
    const email = b64urlDecode(payload).toLowerCase();
    const expected = (await hmacHex(env.MAGIC_SECRET, email)).slice(0, 32);
    return mac === expected ? email : null;
  } catch (e) { return null; }
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

async function sendEmail(env, to, subject, text) {
  if (!env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text }),
  });
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

  const token = await makeToken(email, env);
  const qLink = `${env.SITE_URL}/questions.html?paid=1&t=${token}`;
  const calendly = env.BOOKING_URL ? `\n\nWhen you're ready, book your call here: ${env.BOOKING_URL}` : '';

  ctx.waitUntil(Promise.allSettled([
    sendEmail(env, email,
      'Payment received — one last thing',
      `Thank you${name ? ' ' + name.split(' ')[0] : ''} — your payment is in and we're on.\n\n` +
      `One last thing before your call: answer a few questions so we can prepare properly.\n\n${qLink}\n\n` +
      `The first five unlock the call booking; everything else is optional.${calendly}\n\n— Iternal`),
    sendEmail(env, env.TEAM_EMAIL,
      `Funnel: ${email} paid`,
      `${name || email} paid ${(session.amount_total || 0) / 100} ${(session.currency || 'gbp').toUpperCase()}.\nStripe session: ${session.id}\nMagic link sent.`),
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
  const tokenEmail = body.token ? await emailFromToken(body.token, env) : null;
  const email = tokenEmail || s(body.email, 120).toLowerCase();
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
  const key = tokenEmail ? `client:${email}` : `lead:${email}`;
  const existing = (await env.CLIENTS.get(key, 'json')) || { email, status: tokenEmail ? 'paid' : 'lead' };
  existing.answers = { ...(existing.answers || {}), ...answers };
  existing.answersUpdatedAt = new Date().toISOString();
  if (kind === 'complete') existing.answersComplete = true;
  await env.CLIENTS.put(key, JSON.stringify(existing));

  const summary = Object.entries(existing.answers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
  const calendly = env.BOOKING_URL ? `\n\nBook your call: ${env.BOOKING_URL}` : '';

  const jobs = [
    sendEmail(env, env.TEAM_EMAIL,
      `Funnel: call prep answers (${kind}) — ${email}`,
      `${tokenEmail ? 'Paying client' : 'Unpaid lead'}.\n\n${summary}`),
  ];
  if (kind === 'complete') {
    jobs.push(sendEmail(env, email,
      'Got your answers — next: your call',
      `Thank you — that's exactly what we need to make the call count.\n\n` +
      `After the call, we get to work: two or three working versions of your site for you to choose between.${calendly}\n\n— Iternal`));
  }
  ctx.waitUntil(Promise.allSettled(jobs));

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
