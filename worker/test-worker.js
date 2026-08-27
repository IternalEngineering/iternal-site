// Self-check for worker.js — run: node worker/test-worker.js  (Node 18+)
// Exercises every route with stubbed KV, captured outbound calls, and a real
// HMAC-signed Stripe payload. Fails loudly if any behaviour breaks.
import assert from 'node:assert';
import worker from './worker.js';

const store = new Map();
const env = {
  CLIENTS: {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
  },
  SITE_URL: 'https://iternal.life',
  FROM_EMAIL: 'Iternal <hello@iternal.life>',
  TEAM_EMAIL: 'paul@iternal.life',
  LEAD_API_URL: 'https://script.example/exec',
  CALENDLY_URL: 'https://calendly.com/iternal/test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  MAGIC_SECRET: 'magic_test_secret',
  RESEND_API_KEY: 're_test',
  LEAD_API_SECRET: 'lead_test',
};

let outbound = [];
globalThis.fetch = async (url, opts = {}) => {
  outbound.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return new Response('{}', { status: 200 });
};

const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
const call = (path, init) => worker.fetch(new Request('https://w.example' + path, init), env, ctx);
const drain = () => Promise.allSettled(pending.splice(0));

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// health + 404 + CORS preflight
assert.strictEqual((await call('/health')).status, 200);
assert.strictEqual((await call('/nope')).status, 404);
const pre = await call('/answers', { method: 'OPTIONS' });
assert.strictEqual(pre.status, 204);
assert.strictEqual(pre.headers.get('access-control-allow-origin'), env.SITE_URL);

// webhook: bad signature refused, nothing stored
let r = await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' });
assert.strictEqual(r.status, 400);
assert.strictEqual(store.size, 0);

// webhook: correctly signed checkout.session.completed
const payload = JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_123', amount_total: 37500, currency: 'gbp', customer_details: { email: 'Dana@RiversPottery.co.uk', name: 'Dana Rivers' } } },
});
const t = Math.floor(Date.now() / 1000);
const sig = `t=${t},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`)}`;
r = await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body: payload });
assert.strictEqual(r.status, 200);
await drain();
const client = JSON.parse(store.get('client:dana@riverspottery.co.uk'));
assert.strictEqual(client.status, 'paid');
assert.strictEqual(client.amount, 37500);
assert.strictEqual(outbound.length, 3);
const magicMail = outbound.find(o => o.url.includes('resend') && o.body.to[0] === 'dana@riverspottery.co.uk');
const magicLink = magicMail.body.text.match(/https:\S+/)[0];
assert.ok(magicLink.startsWith('https://iternal.life/questions.html?paid=1&t='));
const tracker = outbound.find(o => o.url.startsWith(env.LEAD_API_URL));
assert.ok(tracker.url.includes('action=createLead') && tracker.url.includes('key=lead_test'));
assert.strictEqual(tracker.body.email, 'dana@riverspottery.co.uk');

// answers with the real token from the magic link -> attaches to the client record
outbound = [];
const token = magicLink.split('t=')[1];
r = await call('/answers', { method: 'POST', body: JSON.stringify({ token, kind: 'complete', answers: { audience: 'gift buyers', pages: ['Home', 'Contact'] } }) });
assert.strictEqual(r.status, 200);
await drain();
const updated = JSON.parse(store.get('client:dana@riverspottery.co.uk'));
assert.strictEqual(updated.answers.audience, 'gift buyers');
assert.deepStrictEqual(updated.answers.pages, ['Home', 'Contact']);
assert.strictEqual(updated.answersComplete, true);
assert.strictEqual(updated.status, 'paid');
assert.strictEqual(outbound.length, 2); // team brief + client confirmation
assert.ok(outbound.some(o => o.body.to && o.body.to[0] === 'dana@riverspottery.co.uk' && o.body.text.includes('calendly.com')));

// tampered token falls back to nothing (no email field either) -> 400
r = await call('/answers', { method: 'POST', body: JSON.stringify({ token: token.slice(0, -4) + 'xxxx', kind: 'partial', answers: {} }) });
assert.strictEqual(r.status, 400);

// no token but an email -> stored as an unpaid lead, team briefed only
outbound = [];
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', kind: 'partial', answers: { mainJob: 'Take bookings' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.strictEqual(JSON.parse(store.get('lead:sam@brightpaws.co.uk')).status, 'lead');
assert.strictEqual(outbound.length, 1);
assert.ok(outbound[0].body.to[0] === env.TEAM_EMAIL && outbound[0].body.text.includes('Unpaid lead'));

// oversized body refused
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'a@b.c', answers: { x: 'y'.repeat(40000) } }) });
assert.strictEqual(r.status, 400);

console.log('All worker checks passed.');
