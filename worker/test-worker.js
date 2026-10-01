// Self-check for worker.js — run: node worker/test-worker.js  (Node 18+)
// Exercises every route with stubbed KV + email binding, captured outbound
// calls, a fake GitHub contents API, and a real HMAC-signed Stripe payload.
// Fails loudly on any break.
import assert from 'node:assert';
import worker from './worker.js';

const store = new Map();
const teamMail = [];
const env = {
  CLIENTS: {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  },
  TEAM_MAIL: { async send(msg) { teamMail.push(msg); } },
  SITE_URL: 'https://iternal.co.uk',
  FROM_EMAIL: 'Website Pipeline <funnel@iternal.co.uk>',
  TEAM_EMAIL: 'paul@iternal.life',
  LEAD_API_URL: 'https://script.example/exec',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  LEAD_API_SECRET: 'lead_test',
};

// Fake GitHub contents API: path -> { json, sha }. `conflictOnce` makes the
// next PUT answer 409, the way a concurrent commit would.
const gh = { files: new Map(), calls: [], conflictOnce: false, n: 0 };
const b64 = s => Buffer.from(s, 'utf-8').toString('base64');
function fakeGitHub(url, opts) {
  gh.calls.push({ method: opts.method || 'GET', auth: opts.headers && opts.headers.authorization });
  const path = url.split('/contents/')[1];
  if ((opts.method || 'GET') === 'GET') {
    const f = gh.files.get(path);
    return f ? new Response(JSON.stringify({ content: b64(f.json), sha: f.sha }), { status: 200 })
             : new Response('{}', { status: 404 });
  }
  const body = JSON.parse(opts.body);
  const cur = gh.files.get(path);
  if (gh.conflictOnce) { gh.conflictOnce = false; return new Response('{}', { status: 409 }); }
  if ((cur && cur.sha) !== body.sha) return new Response('{}', { status: 409 });
  gh.files.set(path, { json: Buffer.from(body.content, 'base64').toString('utf-8'), sha: 'sha' + (++gh.n), message: body.message });
  return new Response('{}', { status: cur ? 200 : 201 });
}
const ghFile = slug => JSON.parse(gh.files.get(`clients/${slug}.json`).json);
const answered = f => f.answers.filter(a => a.answer !== null);
const answerOf = (f, id) => f.answers.find(a => a.id === id);

let outbound = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.github.com/')) return fakeGitHub(String(url), opts);
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
assert.strictEqual(store.get('session:cs_123'), 'dana@riverspottery.co.uk'); // redirect mapping
assert.strictEqual(outbound.length, 1); // tracker only — no client email by design
assert.ok(outbound[0].url.includes('action=createLead') && outbound[0].url.includes('key=lead_test'));
assert.strictEqual(outbound[0].body.email, 'dana@riverspottery.co.uk');
assert.ok(outbound[0].body.message.includes('375 GBP')); // the real amount, never a hardcoded one
assert.strictEqual(teamMail.length, 1);
assert.ok(teamMail[0].raw.includes('Subject: Website Pipeline: dana@riverspottery.co.uk paid'));
assert.strictEqual(gh.calls.length, 0); // pipeline feed is off until PIPELINE_TOKEN is set

// answers carrying the Stripe session id -> attach to the paying client's record
outbound = []; teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ session: 'cs_123', kind: 'complete', answers: { audience: 'gift buyers', pages: ['Home', 'Contact'] } }) });
assert.strictEqual(r.status, 200);
await drain();
const updated = JSON.parse(store.get('client:dana@riverspottery.co.uk'));
assert.strictEqual(updated.answers.audience, 'gift buyers');
assert.deepStrictEqual(updated.answers.pages, ['Home', 'Contact']);
assert.strictEqual(updated.answersComplete, true);
assert.strictEqual(updated.status, 'paid');
assert.strictEqual(outbound.length, 0); // no client email, no extra fetches
assert.strictEqual(teamMail.length, 1);
assert.ok(teamMail[0].raw.includes('Payment received'));
// answers rendered as full question wording, question order, arrays joined
assert.ok(teamMail[0].raw.includes('Who do you most want the site to reach?\n  gift buyers'));
assert.ok(teamMail[0].raw.includes('Which pages do you think you need?\n  Home, Contact'));
assert.ok(teamMail[0].raw.indexOf('site to reach') < teamMail[0].raw.indexOf('pages do you think'));

// unknown session and no email -> refused
r = await call('/answers', { method: 'POST', body: JSON.stringify({ session: 'cs_forged', kind: 'partial', answers: {} }) });
assert.strictEqual(r.status, 400);

// no session but an email -> stored as an unpaid lead, team briefed
teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', kind: 'partial', answers: { mainJob: 'Take bookings' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.strictEqual(JSON.parse(store.get('lead:sam@brightpaws.co.uk')).status, 'lead');
assert.strictEqual(teamMail.length, 1);
assert.ok(teamMail[0].to === env.TEAM_EMAIL && teamMail[0].raw.includes('No payment recorded yet'));

// a separately-requested payment: payment_intent.succeeded marks the lead paid
outbound = []; teamMail.length = 0;
{
  const piPayload = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_777', amount_received: 10000, currency: 'gbp', receipt_email: 'Sam@BrightPaws.co.uk' } },
  });
  const t2 = Math.floor(Date.now() / 1000);
  const sig2 = `t=${t2},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t2}.${piPayload}`)}`;
  const rPi = await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig2 }, body: piPayload });
  assert.strictEqual(rPi.status, 200);
  await drain();
  const upgraded = JSON.parse(store.get('client:sam@brightpaws.co.uk'));
  assert.strictEqual(upgraded.status, 'paid');
  assert.strictEqual(upgraded.paymentIntent, 'pi_777');
  assert.strictEqual(upgraded.answers.mainJob, 'Take bookings'); // lead answers carried over
  assert.ok(!store.get('lead:sam@brightpaws.co.uk')); // lead record retired
  assert.strictEqual(outbound.length, 1); // tracker entry
  assert.ok(outbound[0].url.includes('action=createLead'));
  assert.ok(outbound[0].body.message.includes('100 GBP')); // whatever amount was actually paid
  assert.strictEqual(teamMail.length, 1);
  assert.ok(teamMail[0].raw.includes('payment received — sam@brightpaws.co.uk'));
}

// answers arriving AFTER payment land on the client record (no session id)
teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', kind: 'complete', answers: { timeline: 'As soon as possible' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const after = JSON.parse(store.get('client:sam@brightpaws.co.uk'));
  assert.strictEqual(after.status, 'paid');
  assert.strictEqual(after.answers.timeline, 'As soon as possible');
  assert.strictEqual(after.answersComplete, true);
  assert.ok(teamMail[0].raw.includes('Payment received'));
}

// sign-up: seeds the lead record and carries it to the tracker
outbound = []; teamMail.length = 0;
r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Nadia', lastName: 'Rossi', email: 'Nadia@HarbourlightCafe.co.uk', organisation: 'Harbourlight Cafe', website: 'harbourlightcafe.co.uk', inspiration: 'pawlett' }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const lead = JSON.parse(store.get('lead:nadia@harbourlightcafe.co.uk'));
  assert.strictEqual(lead.org, 'Harbourlight Cafe');
  assert.strictEqual(lead.name, 'Nadia Rossi');
  assert.strictEqual(lead.inspiration, 'Pawlett Pavilion'); // gallery slug resolved
  assert.strictEqual(outbound.length, 1); // one tracker post, nothing else
  assert.ok(outbound[0].url.includes('action=createLead'));
  assert.strictEqual(outbound[0].body.email, 'nadia@harbourlightcafe.co.uk');
  assert.ok(outbound[0].body.message.includes('Signed up'));
  assert.ok(outbound[0].body.message.includes('Pawlett Pavilion example'));
  // the worker briefs the team itself — no third-party relay in the sign-up
  assert.strictEqual(teamMail.length, 1);
  assert.ok(teamMail[0].raw.includes('Subject: Website Pipeline: new sign-up — Harbourlight Cafe'));
  assert.ok(teamMail[0].raw.includes('Email: nadia@harbourlightcafe.co.uk'));
}
// a bot that fills the honeypot gets an OK and leaves no trace anywhere
outbound = []; teamMail.length = 0;
r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'bot@spam.test', organisation: 'Buy Pills', _honey: 'http://spam.test' }) });
assert.strictEqual(r.status, 200);
await drain();
assert.ok(!store.get('lead:bot@spam.test'));
assert.strictEqual(outbound.length, 0);
assert.strictEqual(teamMail.length, 0);
// an unknown gallery slug is dropped, never echoed through
outbound = [];
r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'slug@test.co.uk', inspiration: '<script>alert(1)</script>' }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const lead = JSON.parse(store.get('lead:slug@test.co.uk'));
  assert.strictEqual(lead.inspiration, '');
  assert.ok(!outbound[0].body.message.includes('script'));
}
r = await call('/signup', { method: 'POST', body: JSON.stringify({ organisation: 'No Email Ltd' }) });
assert.strictEqual(r.status, 400); // email required

// unmatched payment (no email) still briefs the team, never silent
teamMail.length = 0;
{
  const piPayload = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_888', amount: 37500, currency: 'gbp' } } });
  const t3 = Math.floor(Date.now() / 1000);
  const sig3 = `t=${t3},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t3}.${piPayload}`)}`;
  const rU = await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig3 }, body: piPayload });
  assert.strictEqual(rU.status, 200);
  await drain();
  assert.strictEqual(teamMail.length, 1);
  assert.ok(teamMail[0].raw.includes('UNMATCHED'));
}

// oversized body refused
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'a@b.c', answers: { x: 'y'.repeat(40000) } }) });
assert.strictEqual(r.status, 400);

// ── Two destinations: the pipeline repo as well as the tracker ──────────
env.PIPELINE_REPO = 'Org/website-build-platform';
env.PIPELINE_TOKEN = 'ghp_test';
const slug = 'omar-kilnworks-co-uk';

// sign-up creates the client file AND still posts to the tracker
outbound = [];
r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Omar', lastName: 'Haddad', email: 'Omar@Kilnworks.co.uk', organisation: 'Kilnworks', website: 'kilnworks.co.uk', inspiration: 'bplaced' }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.slug, slug);
  assert.strictEqual(f.email, 'omar@kilnworks.co.uk');
  assert.strictEqual(f.contact, 'Omar Haddad');
  assert.strictEqual(f.org, 'Kilnworks');
  assert.strictEqual(f.inspiration, 'bPlaced');
  assert.strictEqual(f.stage, 'signed-up');
  assert.strictEqual(f.demoRequested, false); // nothing to build from yet
  assert.deepStrictEqual(f.payment, { status: 'none' });
  assert.strictEqual(outbound.length, 1); // the tracker still got its own post
  assert.ok(outbound[0].url.includes('action=createLead'));
  assert.ok(gh.calls.every(c => c.auth === 'Bearer ghp_test'));
}

// the dashboard writes its own fields — including a deposit marked paid by
// hand (payment may never touch Stripe); the worker must carry them over
{
  const f = ghFile(slug);
  f.notes = 'Prefers a Tuesday call';
  f.payment = { status: 'paid', amount: 10000, at: '2026-09-30', via: 'dashboard' };
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-dashboard' });
}

// first answers: labelled Q&A in page order, terms timestamp lifted out,
// stage moves on, and the pre-call demo build is queued — through a 409
gh.conflictOnce = true;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', kind: 'partial', answers: { timeline: 'Within a month', mainJob: 'Sell products or services', termsAgreed: '2026-09-30T09:00:00.000Z' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.stage, 'answers-in');
  assert.strictEqual(f.demoRequested, true);
  assert.strictEqual(f.stageHistory.length, 2);
  assert.strictEqual(f.termsAgreedAt, '2026-09-30T09:00:00.000Z');
  assert.deepStrictEqual(answered(f).map(a => a.id), ['mainJob', 'timeline']); // page order, terms not an answer
  assert.strictEqual(answerOf(f, 'mainJob').question, "What's the site's main job?");
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Sell products or services');
  // every question is on the record, answered or not, so the dashboard can
  // fill in what they skipped without its own copy of the question list
  assert.strictEqual(f.answers.length, 17);
  assert.deepStrictEqual(f.answers.slice(0, 2).map(a => a.id), ['email', 'mainJob']);
  assert.strictEqual(answerOf(f, 'pages').answer, null);
  assert.strictEqual(f.notes, 'Prefers a Tuesday call'); // dashboard field survived
  assert.strictEqual(f.payment.via, 'dashboard'); // a hand-marked payment is never downgraded
}

// an agent builds the demo and clears the flag; later answers must not
// re-queue it or move the stage back
{
  const f = ghFile(slug);
  f.demoRequested = false;
  f.stage = 'demo-built';
  f.demo = { path: `demos/${slug}`, builtAt: '2026-09-30' };
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-agent' });
}
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', kind: 'complete', answers: { feel: 'Made by people who care' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.stage, 'demo-built');
  assert.strictEqual(f.demoRequested, false);
  assert.strictEqual(f.demo.path, `demos/${slug}`);
  assert.strictEqual(f.answersComplete, true);
  assert.strictEqual(answered(f).length, 3);
}

// the team corrects one answer and fills in one the client skipped (the
// dashboard's pencil); a later sync from the funnel must leave both alone
{
  const f = ghFile(slug);
  Object.assign(answerOf(f, 'mainJob'), { answer: 'Take bookings or enquiries', client: 'Sell products or services', editedAt: '2026-09-30' });
  Object.assign(answerOf(f, 'pages'), { answer: ['Home', 'Shop'], client: null, editedAt: '2026-09-30' });
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-pencil' });
}
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', kind: 'partial', answers: { audience: 'Interior designers' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Take bookings or enquiries'); // team edit stands
  assert.strictEqual(answerOf(f, 'mainJob').client, 'Sell products or services');
  assert.deepStrictEqual(answerOf(f, 'pages').answer, ['Home', 'Shop']); // so does the filled-in one
  assert.strictEqual(answerOf(f, 'audience').answer, 'Interior designers'); // and the new answer arrived
}
// ...until the client changes that answer themselves: theirs is the newer word
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', kind: 'partial', answers: { mainJob: 'Publish news or content' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Publish news or content');
  assert.ok(!('client' in answerOf(f, 'mainJob'))); // the edit marker is gone with the edit
  assert.deepStrictEqual(answerOf(f, 'pages').answer, ['Home', 'Shop']); // untouched by that
}

// a payment lands on the same file, with the amount actually paid
{
  const piPayload = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_999', amount_received: 22500, currency: 'gbp', receipt_email: 'omar@kilnworks.co.uk' } } });
  const t4 = Math.floor(Date.now() / 1000);
  const sig4 = `t=${t4},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t4}.${piPayload}`)}`;
  assert.strictEqual((await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig4 }, body: piPayload })).status, 200);
  await drain();
  const f = ghFile(slug);
  assert.strictEqual(f.payment.status, 'paid');
  assert.strictEqual(f.payment.amount, 22500);
  assert.strictEqual(f.payment.via, 'stripe'); // a real Stripe payment is the stronger record
  assert.ok(answered(f).length >= 3); // answers survived the lead -> client move
}

// a GitHub outage must never fail the client's request
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => String(url).startsWith('https://api.github.com/')
    ? new Response('{}', { status: 500 }) : realFetch(url, opts);
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'outage@test.co.uk' }) });
  assert.strictEqual(r.status, 200);
  await drain();
  globalThis.fetch = realFetch;
}

// team briefs: one copy per address in TEAM_EMAIL
env.TEAM_EMAIL = 'websites@iternal.life, john@iternal.life';
teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', kind: 'partial', answers: { wrong: 'Dated' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.deepStrictEqual(teamMail.map(m => m.to).sort(), ['john@iternal.life', 'websites@iternal.life']);

console.log('All worker checks passed.');
