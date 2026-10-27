// Self-check for worker.js — run: node worker/test-worker.js  (Node 18+)
// Exercises every route with stubbed KV + email binding, captured outbound
// calls and a fake GitHub contents API.
// Fails loudly on any break.
import assert from 'node:assert';
import worker from './worker.js';

const store = new Map();
const teamMail = [];
const clientMail = [];
const env = {
  CLIENTS: {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  },
  TEAM_MAIL: { async send(msg) { teamMail.push(msg); } },
  CLIENT_MAIL: { async send(msg) { clientMail.push(msg); } },
  CLIENT_FROM: 'Iternal <websites@iternal.co.uk>',
  CLIENT_REPLY_TO: 'hello@iternal.life',
  SITE_URL: 'https://iternal.co.uk',
  FROM_EMAIL: 'Website Pipeline <funnel@iternal.co.uk>',
  TEAM_EMAIL: 'paul@iternal.life',
  LEAD_API_URL: 'https://script.example/exec',
  LEAD_API_SECRET: 'lead_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_API_KEY: 'rk_test_x',
  STRIPE_PRICE: 'price_test',
  STRIPE_TAX_RATE: 'txr_test',
  BOOKING_URL: 'https://calendar.example/book',
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

// Fake Stripe: each Checkout Session created is kept; `fail` makes it refuse.
const stripeApi = { sessions: [], fail: false };
let outbound = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.github.com/')) return fakeGitHub(String(url), opts);
  if (String(url) === 'https://api.stripe.com/v1/checkout/sessions') {
    if (stripeApi.fail) return new Response('{"error":{"message":"Invalid API Key provided"}}', { status: 401 });
    const id = 'cs_test_' + (stripeApi.sessions.length + 1);
    stripeApi.sessions.push({ id, auth: opts.headers.authorization, p: Object.fromEntries(new URLSearchParams(opts.body)) });
    return new Response(JSON.stringify({ id, url: 'https://checkout.stripe.com/c/pay/' + id }), { status: 200 });
  }
  if (String(url).endsWith('.pdf')) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }); // the published terms
  outbound.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  // the Lead Tracker answers {ok, id}; nothing else is called
  return new Response(String(url).includes('script.example') ? '{"ok":true,"id":"t1"}' : '{}', { status: 200 });
};

const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
const call = (path, init) => worker.fetch(new Request('https://w.example' + path, init), env, ctx);
const drain = () => Promise.allSettled(pending.splice(0));
// A Stripe event signed the way Stripe signs it: v1 = HMAC-SHA256(secret, `${t}.${body}`).
async function stripe(event, { t = Math.floor(Date.now() / 1000), secret = env.STRIPE_WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))).toString('hex');
  return call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body });
}
// A completed Checkout from one of the worker's own payment pages.
const paidSession = (id, ref, o = {}) => ({ type: 'checkout.session.completed', data: { object: { id, client_reference_id: ref, metadata: { funnel: 'website-build' }, payment_status: 'paid', amount_total: 10000, currency: 'gbp', ...o } } });

// health + 404 + CORS preflight
assert.strictEqual((await call('/health')).status, 200);
assert.strictEqual((await call('/nope')).status, 404);
const pre = await call('/answers', { method: 'OPTIONS' });
assert.strictEqual(pre.status, 204);
assert.strictEqual(pre.headers.get('access-control-allow-origin'), env.SITE_URL);

// the Stripe webhook refuses anything not signed with the endpoint's secret,
// or signed too long ago, and stores nothing
let r = await call('/stripe-webhook', { method: 'POST', body: '{}' });
assert.strictEqual(r.status, 400);
assert.strictEqual((await call('/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' })).status, 400);
assert.strictEqual((await stripe(paidSession('cs_forged', 'WB-0000-AAAA'), { secret: 'whsec_wrong' })).status, 400);
assert.strictEqual((await stripe(paidSession('cs_stale', 'WB-0000-AAAA'), { t: Math.floor(Date.now() / 1000) - 600 })).status, 400);
assert.strictEqual(store.size, 0);

// answers need a sign-up and an accepted order: anyone else's are refused,
// and nothing is stored or sent
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'Sam@BrightPaws.co.uk', kind: 'complete', answers: { mainJob: 'Take bookings' } }) });
assert.strictEqual(r.status, 409);
await drain();
assert.ok(!store.get('lead:sam@brightpaws.co.uk'));
assert.strictEqual(outbound.length + teamMail.length + clientMail.length, 0);

// signed up, accepted and paid: answers are stored on the lead record and
// briefed to the team; the tracker never receives answers
r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Sam', lastName: 'Okafor', email: 'Sam@BrightPaws.co.uk', organisation: 'Bright Paws' }) });
const { token: samToken, order: samOrder } = await r.json();
r = await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', token: samToken, termsVersion: '1.0', accepted: true, authorised: true }) });
assert.strictEqual(r.status, 200);
await drain();
// accepted but not paid yet: the questions stay shut, answers refused
assert.strictEqual((await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', token: samToken, kind: 'complete', answers: { mainJob: 'x' } }) })).status, 409);
assert.ok(!JSON.parse(store.get('lead:sam@brightpaws.co.uk')).answers);
assert.strictEqual((await stripe(paidSession('cs_sam', samOrder.reference))).status, 200);
await drain();
outbound = []; teamMail.length = 0; clientMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'Sam@BrightPaws.co.uk', token: samToken, kind: 'complete', answers: { mainJob: 'Take bookings', audience: 'gift buyers', pages: ['Home', 'Contact'] } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const lead = JSON.parse(store.get('lead:sam@brightpaws.co.uk'));
  assert.strictEqual(lead.status, 'lead');
  assert.strictEqual(lead.answers.audience, 'gift buyers');
  assert.deepStrictEqual(lead.answers.pages, ['Home', 'Contact']);
  assert.strictEqual(lead.answersComplete, true);
}
assert.strictEqual(outbound.length, 0); // no tracker post, no client email
assert.strictEqual(gh.calls.length, 0); // pipeline feed is off until PIPELINE_TOKEN is set
assert.strictEqual(teamMail.length, 1);
assert.strictEqual(teamMail[0].to, env.TEAM_EMAIL);
// answers rendered as full question wording, question order, arrays joined
assert.ok(teamMail[0].raw.includes('Who do you most want the site to reach?\n  gift buyers'));
assert.ok(teamMail[0].raw.includes('Which pages do you think you need?\n  Home, Contact'));
assert.ok(teamMail[0].raw.indexOf('site to reach') < teamMail[0].raw.indexOf('pages do you think'));
assert.ok(!/payment/i.test(teamMail[0].raw));

// no email: refused
r = await call('/answers', { method: 'POST', body: JSON.stringify({ kind: 'partial', answers: {} }) });
assert.strictEqual(r.status, 400);

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
  assert.strictEqual(outbound[0].body.event, 'signed-up'); // the tracker words its ping by this
  assert.ok(outbound[0].body.message.includes('reference ' + lead.reference));
  assert.strictEqual(outbound[0].body.reference, lead.reference); // its own column in the tracker
  assert.strictEqual(store.get('ref:' + lead.reference), 'nadia@harbourlightcafe.co.uk'); // claimed for good
  assert.ok(outbound[0].body.message.includes('Pawlett Pavilion example'));
  // the worker briefs the team itself — no third-party relay in the sign-up
  assert.strictEqual(teamMail.length, 1);
  assert.ok(teamMail[0].raw.includes('Subject: Website Pipeline: new sign-up — Harbourlight Cafe'));
  assert.ok(teamMail[0].raw.includes('Email: nadia@harbourlightcafe.co.uk'));
  assert.ok(teamMail[0].raw.includes('Reference: ' + lead.reference));
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

// a reference already issued is never issued again: a clashing draw is redrawn
{
  const yymm = new Date().toISOString().slice(2, 7).replace('-', '');
  store.set(`ref:WB-${yymm}-AAAA`, 'someone@else.co.uk');
  let draws = 0;
  crypto.getRandomValues = function (arr) { return ++draws === 1 ? arr.fill(0) : Object.getPrototypeOf(crypto).getRandomValues.call(crypto, arr); }; // first draw: AAAA
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'clash@test.co.uk', organisation: 'Clash Ltd' }) });
  delete crypto.getRandomValues;
  const { order } = await r.json();
  assert.strictEqual(draws, 2);
  assert.notStrictEqual(order.reference, `WB-${yymm}-AAAA`);
  assert.strictEqual(store.get(`ref:${order.reference}`), 'clash@test.co.uk');
  assert.strictEqual(store.get(`ref:WB-${yymm}-AAAA`), 'someone@else.co.uk'); // untouched
  await drain();
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
const { token: omarToken, order: omarOrder } = await r.json();
assert.ok(omarToken && omarToken.length > 20); // the browser keeps this for /answers
// ...and gets the order to review: their details, a reference, the fees and
// the terms version
assert.deepStrictEqual({ ...omarOrder, reference: 'x' }, { company: 'Kilnworks', name: 'Omar Haddad', email: 'omar@kilnworks.co.uk', reference: 'x', buildFee: 750, downpayment: 100, completion: 650, carePlan: 50, termsVersion: '1.0' });
assert.match(omarOrder.reference, /^WB-\d{4}-[A-HJ-NP-Z2-9]{4}$/);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.slug, slug);
  assert.strictEqual(f.email, 'omar@kilnworks.co.uk');
  assert.strictEqual(f.contact, 'Omar Haddad');
  assert.strictEqual(f.org, 'Kilnworks');
  assert.strictEqual(f.inspiration, 'bPlaced');
  assert.strictEqual(f.reference, omarOrder.reference); // the team can match it before acceptance
  assert.strictEqual(f.stage, 'signed-up');
  assert.strictEqual(f.demoRequested, false); // nothing to build from yet
  assert.ok(!('payment' in f)); // payment lives in the tracker, never here
  assert.ok(!('token' in f)); // the browser's token never leaves KV
  assert.strictEqual(outbound.length, 1); // the tracker still got its own post
  assert.ok(outbound[0].url.includes('action=createLead'));
  assert.ok(gh.calls.every(c => c.auth === 'Bearer ghp_test'));
}

// the dashboard writes its own fields; the worker must carry them over
{
  const f = ghFile(slug);
  f.notes = 'Prefers a Tuesday call';
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-dashboard' });
}

// ── Accepting the terms ─────────────────────────────────────────────────
assert.deepStrictEqual(ghFile(slug).progress.step, 'signed-up');
const accept = (extra = {}) => call('/accept', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, termsVersion: '1.0', accepted: true, authorised: true, ...extra }) });
teamMail.length = 0; outbound = []; stripeApi.sessions.length = 0;
// refused: not their browser, no sign-up, a box left unticked, a version
// they were never shown (which hands back the current order to review)
assert.strictEqual((await accept({ token: 'guess' })).status, 403);
assert.strictEqual((await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'nobody@x.co.uk', token: omarToken, termsVersion: '1.0', accepted: true, authorised: true }) })).status, 404);
assert.strictEqual((await accept({ authorised: false })).status, 400);
assert.strictEqual((await accept({ accepted: 'yes' })).status, 400);
r = await accept({ termsVersion: '0.9' });
assert.strictEqual(r.status, 409);
assert.strictEqual((await r.json()).order.termsVersion, '1.0');
await drain();
assert.ok(!JSON.parse(store.get('lead:omar@kilnworks.co.uk')).acceptance);
assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
assert.strictEqual(stripeApi.sessions.length, 0); // no payment page for a refused acceptance
// accepted: the record keeps exactly what they saw, and the answer is their
// own Stripe payment page
r = await accept();
assert.strictEqual(r.status, 200);
assert.strictEqual((await r.json()).pay, 'https://checkout.stripe.com/c/pay/cs_test_1');
await drain();
{
  const acc = JSON.parse(store.get('lead:omar@kilnworks.co.uk')).acceptance;
  assert.deepStrictEqual({ ...acc, acceptedAt: 'x' }, { ...omarOrder, acceptedAt: 'x' });
  assert.ok(Date.parse(acc.acceptedAt));
  const f = ghFile(slug);
  assert.deepStrictEqual(f.acceptance, acc); // on the dashboard too
  // the IP address they accepted from is kept as evidence, but never leaves the worker
  assert.strictEqual(JSON.parse(store.get('lead:omar@kilnworks.co.uk')).acceptanceIp, '203.0.113.7');
  assert.ok(!JSON.stringify(f).includes('203.0.113.7'));
  assert.strictEqual(f.progress.step, 'terms-agreed');
  // the payment page: the dashboard's price and VAT rate, their email, their
  // reference (to match the payment, and on the invoice), marked as ours
  const { auth, p } = stripeApi.sessions[0];
  assert.strictEqual(auth, 'Bearer rk_test_x');
  assert.strictEqual(p.mode, 'payment');
  assert.strictEqual(p['line_items[0][price]'], 'price_test');
  assert.strictEqual(p['line_items[0][tax_rates][0]'], 'txr_test');
  assert.strictEqual(p.customer_email, 'omar@kilnworks.co.uk');
  assert.strictEqual(p.client_reference_id, acc.reference);
  assert.strictEqual(p['metadata[funnel]'], 'website-build');
  assert.strictEqual(p['custom_text[submit][message]'], `Kilnworks: upfront payment towards your website build fee (${acc.reference}).`);
  assert.strictEqual(p['invoice_creation[enabled]'], 'true');
  assert.strictEqual(p['invoice_creation[invoice_data][custom_fields][0][value]'], acc.reference);
  assert.strictEqual(p.success_url, 'https://iternal.co.uk/questions?paid=1');
  assert.strictEqual(p.cancel_url, 'https://iternal.co.uk/start');
  // nothing to the client until they have paid
  assert.strictEqual(clientMail.length, 0);
  // the team is told payment comes next; the tracker gets a note, never answers
  const brief = teamMail.find(t => t.raw.includes('Subject: Website Pipeline: terms accepted — Kilnworks'));
  assert.ok(brief && brief.raw.includes('They pay the £100 downpayment (including VAT) next, on Stripe\'s payment page.'));
  assert.ok(brief.raw.includes('£650 (including VAT) follows on completion'));
  assert.ok(!brief.raw.includes('book their call:'));
  const note = outbound.find(o => o.url.includes('action=createLead'));
  assert.strictEqual(note.body.event, 'accepted');
  assert.ok(note.body.message.includes('Accepted the Iternal Website Build and Care Terms, version 1.0 (reference ' + acc.reference + ')'));
  assert.ok(note.body.message.includes('£100 downpayment + £650 upon completion, including VAT: the downpayment is paid next, through Stripe'));
  assert.ok(!('answers' in note.body));
}
// back from Stripe without paying: accepting again is a fresh payment page and nothing else
teamMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  r = await accept();
  assert.strictEqual((await r.json()).pay, 'https://checkout.stripe.com/c/pay/cs_test_2');
  await drain();
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
  // a page Stripe will not make is an error the client can retry; the acceptance stands
  stripeApi.fail = true;
  assert.strictEqual((await accept()).status, 502);
  stripeApi.fail = false;
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
}

// ── The downpayment (Stripe Checkout, from the page accepting answered with) ──
// a paid Checkout is matched to the order by its reference, recorded once in
// KV, confirmed to the client with the terms attached, briefed to the team and
// noted in the tracker; the pipeline repo never hears about payment
teamMail.length = 0; clientMail.length = 0; outbound = [];
const omarRef = omarOrder.reference;
{
  const ghWrites = gh.calls.length;
  r = await stripe(paidSession('cs_test_2', omarRef));
  assert.strictEqual(r.status, 200);
  await drain();
  const rec = JSON.parse(store.get('lead:omar@kilnworks.co.uk'));
  assert.deepStrictEqual({ ...rec.payment, paidAt: 'x' }, { id: 'cs_test_2', amount: 10000, currency: 'gbp', paidAt: 'x' });
  // the confirmation, worded as the team's sign-up example
  assert.strictEqual(clientMail.length, 1);
  const m = clientMail[0];
  assert.strictEqual(m.to, 'omar@kilnworks.co.uk');
  assert.deepStrictEqual(m.from, { name: 'Iternal', email: 'websites@iternal.co.uk' });
  assert.strictEqual(m.replyTo, 'hello@iternal.life');
  assert.strictEqual(m.subject, `Welcome to Iternal: your website order is confirmed (${omarRef})`);
  assert.ok(m.text.startsWith('Hi Omar,\n\nThank you for choosing Iternal to build and look after your website.'));
  assert.ok(m.text.includes('a copy of our Iternal Website Build and Care Terms (version 1.0) is attached for your records.'));
  assert.ok(m.text.includes(`Your order\nName or business name: Kilnworks\nReference: ${omarRef}\nBuild fee: £750, with £100 paid today and £650 payable on completion\nCare plan: £50 per month, starting from the month after your site goes live\nAccepted by: Omar Haddad on `));
  assert.match(m.text, /Accepted by: Omar Haddad on \d{1,2} [A-Z][a-z]+ \d{4} at \d{2}:\d{2}\n/);
  assert.ok(m.text.includes('you can do so here: https://calendar.example/book.'));
  assert.ok(m.text.endsWith('We look forward to working with you.\nThe Iternal team\n'));
  assert.strictEqual(m.attachments[0].filename, 'Iternal Website Build and Care Terms v1.0.pdf');
  assert.strictEqual(m.attachments[0].type, 'application/pdf');
  assert.strictEqual(m.attachments[0].content.byteLength, 4);
  assert.strictEqual(teamMail.length, 1);
  assert.ok(teamMail[0].raw.includes('Subject: Website Pipeline: paid — Kilnworks'));
  assert.ok(teamMail[0].raw.includes(`Omar Haddad (Kilnworks, reference ${omarRef}) paid £100. Their confirmation email has gone`));
  assert.strictEqual(outbound.length, 1);
  assert.strictEqual(outbound[0].body.reference, omarRef);
  assert.strictEqual(outbound[0].body.message, 'Paid £100 via Stripe (cs_test_2).');
  assert.strictEqual(gh.calls.length, ghWrites);
  assert.ok(!('payment' in ghFile(slug)));
}
// Stripe's retry changes nothing; the same payment's payment_intent event is not ours to act on
teamMail.length = 0; clientMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  assert.strictEqual((await (await stripe(paidSession('cs_test_2', omarRef))).json()).duplicate, true);
  r = await stripe({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_omar', amount: 10000, amount_received: 10000, currency: 'gbp', metadata: {} } } });
  assert.strictEqual((await r.json()).ignored, 'payment_intent.succeeded');
  await drain();
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
}
// every other payment on the account is outside this project: the final
// payment, a Payment Link, an unpaid Checkout, anything not from our pages
teamMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  for (const ev of [
    { type: 'checkout.session.completed', data: { object: { id: 'cs_final', payment_link: 'plink_1', payment_status: 'paid', amount_total: 65000, currency: 'gbp', client_reference_id: omarRef } } },
    paidSession('cs_other', omarRef, { metadata: { funnel: 'something-else' } }),
    paidSession('cs_unpaid', omarRef, { payment_status: 'unpaid' }),
    { type: 'invoice.paid', data: { object: { id: 'in_1', amount_paid: 65000 } } },
    { type: 'charge.refunded', data: { object: {} } },
  ]) assert.ok((await (await stripe(ev)).json()).ignored);
  await drain();
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
  assert.ok(![...store.keys()].some(k => /stripe:cs_(final|other|unpaid)/.test(k)));
}
// money in never passes silently: paying a second page for a paid order, or a
// payment whose order has gone, reaches the team once and nobody else
teamMail.length = 0; clientMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  r = await stripe(paidSession('cs_test_3', omarRef));
  assert.strictEqual((await r.json()).unmatched, true);
  r = await stripe(paidSession('cs_gone', 'WB-0000-ZZZZ'));
  assert.strictEqual((await r.json()).unmatched, true);
  assert.strictEqual((await (await stripe(paidSession('cs_gone', 'WB-0000-ZZZZ'))).json()).duplicate, true);
  await drain();
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length, 2);
  assert.ok(teamMail[0].raw.includes(`Subject: Website Pipeline: payment needs a look — ${omarRef}`));
  assert.ok(teamMail[0].raw.includes('but that order was already paid (Stripe cs_test_2): refund one of them in Stripe.'));
  assert.ok(teamMail[1].raw.includes('£100 arrived for WB-0000-ZZZZ (Stripe cs_gone), but it matches no order waiting for payment'));
  assert.strictEqual(clientMail.length + outbound.length, 0);
}
// paid: accepting again goes straight on, with no new payment page and nothing sent
teamMail.length = 0; clientMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  const pages = stripeApi.sessions.length;
  r = await accept();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ok: true, paid: true });
  await drain();
  assert.strictEqual(stripeApi.sessions.length, pages);
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
}
// one sign-up per email: anyone else is refused and nothing changes (no
// token, no new company on the order); the browser that signed up gets its
// order back
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Mallory', email: 'omar@kilnworks.co.uk', organisation: 'Other Ltd' }) });
  assert.strictEqual(r.status, 409);
  assert.ok(!('token' in await r.json()));
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', organisation: 'Other Ltd', token: omarToken }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).order.company, 'Kilnworks');
  await drain();
  assert.strictEqual(store.get('lead:omar@kilnworks.co.uk'), before);
  assert.strictEqual(teamMail.length + clientMail.length + outbound.length, 0);
}
// a sign-up without a company can never accept: the order must name one
r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Lee', email: 'lee@solo.co.uk' }) });
{
  const { token, order } = await r.json();
  assert.strictEqual(order.company, '');
  r = await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'lee@solo.co.uk', token, termsVersion: '1.0', accepted: true, authorised: true }) });
  assert.strictEqual(r.status, 400);
  await drain();
  assert.strictEqual(JSON.parse(store.get('lead:lee@solo.co.uk')).org, ''); // briefs fall back to the person; the order does not
}
// when the confirmation cannot go, the team gets it to forward: never silent
{
  const sendBefore = env.CLIENT_MAIL.send;
  env.CLIENT_MAIL.send = async () => { throw Object.assign(new Error('Domain not onboarded'), { code: 'E_SENDER_DOMAIN_NOT_AVAILABLE' }); };
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Ana', lastName: 'Silva', email: 'ana@tidewater.co.uk', organisation: 'Tidewater' }) });
  const { token, order } = await r.json();
  r = await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'ana@tidewater.co.uk', token, termsVersion: '1.0', accepted: true, authorised: true }) });
  await drain();
  teamMail.length = 0;
  r = await stripe(paidSession('cs_ana', order.reference));
  assert.strictEqual(r.status, 200); // she has paid; the failure is ours to handle
  await drain();
  env.CLIENT_MAIL.send = sendBefore;
  const failMail = teamMail.find(t => t.raw.includes('confirmation FAILED — Tidewater'));
  assert.ok(failMail && failMail.raw.includes('Domain not onboarded') && failMail.raw.includes('Forward the text below to ana@tidewater.co.uk'));
  assert.ok(failMail.raw.includes('Build fee: £750, with £100 paid today and £650 payable on completion'));
}

// progress after accepting: a first answer saved as they leave. The team can
// see where they are; nothing is queued and nobody is emailed.
teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'update', answers: { mainJob: 'Sell products or services' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.progress.step, 'answering');
  assert.ok(f.progress.lastActiveAt);
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Sell products or services'); // there to chase with
  assert.strictEqual(f.demoRequested, false); // stopping half-way is followed up, not built for
  assert.ok(!f.demoQueuedAt);
  assert.strictEqual(teamMail.length, 0);
}
// a page saving by itself, with no sign-up behind it, creates nothing
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'passer@by.co.uk', kind: 'update', answers: { mainJob: 'x' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.ok(!store.get('lead:passer@by.co.uk') && !gh.files.has('clients/passer-by-co-uk.json'));

// first answers: labelled Q&A in page order, stage moves on, and the
// pre-call demo build is queued — through a 409
gh.conflictOnce = true;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { timeline: 'Within a month', mainJob: 'Sell products or services' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.stage, 'signed-up'); // answers are part of signing up, not a stage
  assert.ok(f.demoQueuedAt);
  assert.strictEqual(f.progress.step, 'booked'); // clicking Book your call queues the demo
  assert.strictEqual(f.demoRequested, true);
  assert.strictEqual(f.stageHistory.length, 2); // the queueing is still on the record
  assert.strictEqual(f.acceptance.reference, omarOrder.reference); // answers leave the acceptance alone
  assert.deepStrictEqual(answered(f).map(a => a.id), ['mainJob', 'timeline']); // page order
  assert.strictEqual(answerOf(f, 'mainJob').question, "What's the site's main job?");
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Sell products or services');
  // every question is on the record, answered or not, so the dashboard can
  // fill in what they skipped without its own copy of the question list
  assert.strictEqual(f.answers.length, 17);
  assert.deepStrictEqual(f.answers.slice(0, 2).map(a => a.id), ['email', 'mainJob']);
  assert.strictEqual(answerOf(f, 'pages').answer, null);
  assert.strictEqual(f.notes, 'Prefers a Tuesday call'); // dashboard field survived
}

// the team cancels the request before any build; more answers must not
// re-queue it (the queue fires once, on the first answers)
{
  const f = ghFile(slug);
  f.demoRequested = false;
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-cancel' });
}
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { anything: 'No' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.strictEqual(ghFile(slug).demoRequested, false);

// an agent builds the demo and clears the flag; later answers must not
// re-queue it or move the stage back
{
  const f = ghFile(slug);
  f.demoRequested = false;
  f.stage = 'demo-built';
  f.demo = { path: `demos/${slug}`, builtAt: '2026-09-30' };
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-agent' });
}
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'complete', answers: { feel: 'Made by people who care' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(f.stage, 'demo-built');
  assert.strictEqual(f.demoRequested, false);
  assert.strictEqual(f.demo.path, `demos/${slug}`);
  assert.strictEqual(f.answersComplete, true);
  assert.strictEqual(answered(f).length, 4);
}

// the team corrects one answer and fills in one the client skipped (the
// dashboard's pencil); a later sync from the funnel must leave both alone
{
  const f = ghFile(slug);
  Object.assign(answerOf(f, 'mainJob'), { answer: 'Take bookings or enquiries', client: 'Sell products or services', editedAt: '2026-09-30' });
  Object.assign(answerOf(f, 'pages'), { answer: ['Home', 'Shop'], client: null, editedAt: '2026-09-30' });
  gh.files.set(`clients/${slug}.json`, { json: JSON.stringify(f), sha: 'sha-pencil' });
}
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { audience: 'Interior designers' } }) });
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
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { mainJob: 'Publish news or content' } }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const f = ghFile(slug);
  assert.strictEqual(answerOf(f, 'mainJob').answer, 'Publish news or content');
  assert.ok(!('client' in answerOf(f, 'mainJob'))); // the edit marker is gone with the edit
  assert.deepStrictEqual(answerOf(f, 'pages').answer, ['Home', 'Shop']); // untouched by that
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
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { wrong: 'Dated' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.deepStrictEqual(teamMail.map(m => m.to).sort(), ['john@iternal.life', 'websites@iternal.life']);

// ── Review fixes ────────────────────────────────────────────────────────
// knowing an email is not enough to rewrite that client's answers
outbound = []; teamMail.length = 0;
{
  const calls = gh.calls.length;
  const before = JSON.stringify(ghFile(slug));
  for (const body of [{ email: 'omar@kilnworks.co.uk', kind: 'partial', answers: { audience: 'junk' } },
                      { email: 'omar@kilnworks.co.uk', token: 'guess', kind: 'partial', answers: { audience: 'junk' } }]) {
    const rr = await call('/answers', { method: 'POST', body: JSON.stringify(body) });
    assert.strictEqual(rr.status, 403);
  }
  await drain();
  assert.strictEqual(JSON.parse(store.get('lead:omar@kilnworks.co.uk')).answers.audience, 'Interior designers'); // untouched
  assert.strictEqual(gh.calls.length, calls);
  assert.strictEqual(teamMail.length, 0);
  assert.strictEqual(JSON.stringify(ghFile(slug)), before);
}
// signed up but never accepted: booking or sending is refused, saving is ignored
{
  const lee = JSON.parse(store.get('lead:lee@solo.co.uk'));
  r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'lee@solo.co.uk', token: lee.token, kind: 'partial', answers: { mainJob: 'x' } }) });
  assert.strictEqual(r.status, 409);
  r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'lee@solo.co.uk', token: lee.token, kind: 'update', answers: { mainJob: 'x' } }) });
  assert.strictEqual(r.status, 200);
  await drain();
  assert.ok(!JSON.parse(store.get('lead:lee@solo.co.uk')).answers);
  assert.strictEqual(teamMail.length, 0);
}
// where a client is: the booking link only once they have paid, and only to
// the browser that signed up
{
  const status = body => call('/status', { method: 'POST', body: JSON.stringify(body) });
  assert.strictEqual((await status({ email: 'nobody@x.co.uk', token: 't' })).status, 404);
  assert.strictEqual((await status({ email: 'omar@kilnworks.co.uk', token: 'guess' })).status, 403);
  const lee = JSON.parse(store.get('lead:lee@solo.co.uk'));
  r = await status({ email: 'lee@solo.co.uk', token: lee.token });
  assert.deepStrictEqual(await r.json(), { ok: true, accepted: false, paid: false });
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Una', email: 'una@unpaid.co.uk', organisation: 'Unpaid Ltd' }) });
  const una = await r.json();
  await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'una@unpaid.co.uk', token: una.token, termsVersion: '1.0', accepted: true, authorised: true }) });
  r = await status({ email: 'Una@Unpaid.co.uk', token: una.token });
  assert.deepStrictEqual(await r.json(), { ok: true, accepted: true, paid: false }); // no booking link
  r = await status({ email: 'omar@kilnworks.co.uk', token: omarToken });
  assert.deepStrictEqual(await r.json(), { ok: true, accepted: true, paid: true, booking: 'https://calendar.example/book' });
  await drain();
}
// Sam's answers reach the dashboard too, now the feed is on
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', token: samToken, kind: 'partial', answers: { pages: ['Home'] } }) });
assert.strictEqual(r.status, 200);

// resending identical answers does not move answersUpdatedAt
{
  const t0 = JSON.parse(store.get('lead:omar@kilnworks.co.uk')).answersUpdatedAt;
  const cur = JSON.parse(store.get('lead:omar@kilnworks.co.uk')).answers;
  await new Promise(res => setTimeout(res, 5));
  r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'partial', answers: { audience: cur.audience } }) });
  assert.strictEqual(r.status, 200);
  await drain();
  assert.strictEqual(JSON.parse(store.get('lead:omar@kilnworks.co.uk')).answersUpdatedAt, t0);
}

// degenerate emails are refused
for (const bad of ['@', 'a@b', 'nobody', 'a b@c.com']) {
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: bad }) });
  assert.strictEqual(r.status, 400, `accepted ${bad}`);
}

// a sync failure is never silent: the team gets an email naming the client
teamMail.length = 0;
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => String(url).startsWith('https://api.github.com/')
    ? new Response('{}', { status: 401 }) : realFetch(url, opts);
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'alert@test.co.uk', organisation: 'Alert Ltd' }) });
  assert.strictEqual(r.status, 200);
  await drain();
  globalThis.fetch = realFetch;
  const failMail = teamMail.find(m => m.raw.includes('dashboard sync FAILED'));
  assert.ok(failMail, 'no failure email');
  assert.ok(failMail.raw.includes('alert@test.co.uk') && failMail.raw.includes('token rejected'));
}

// two emails that collapse to one slug never overwrite each other
teamMail.length = 0;
{
  gh.files.set('clients/pat-smith-x-com.json', { json: JSON.stringify({ slug: 'pat-smith-x-com', email: 'pat.smith@x.com', org: 'First' }), sha: 'sha-first' });
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'pat-smith@x.com', organisation: 'Second' }) });
  assert.strictEqual(r.status, 200);
  await drain();
  assert.strictEqual(JSON.parse(gh.files.get('clients/pat-smith-x-com.json').json).org, 'First'); // untouched
  assert.ok(teamMail.some(m => m.raw.includes('dashboard sync FAILED') && m.raw.includes('already belongs to pat.smith@x.com')));
}

// a tracker that rejects the post is reported, not ignored
teamMail.length = 0;
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => String(url).includes('script.example')
    ? new Response('{"ok":false,"error":"unauthorised"}', { status: 200 }) : realFetch(url, opts);
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'tracker@test.co.uk', organisation: 'Tracker Ltd' }) });
  assert.strictEqual(r.status, 200);
  await drain();
  globalThis.fetch = realFetch;
  const failMail = teamMail.find(m => m.raw.includes('tracker post FAILED'));
  assert.ok(failMail && failMail.raw.includes('unauthorised') && failMail.raw.includes('tracker@test.co.uk'));
}
// ...and so is a sign-in page answered with status 200 (Apps Script does this)
teamMail.length = 0;
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => String(url).includes('script.example')
    ? new Response('<html>Sign in</html>', { status: 200 }) : realFetch(url, opts);
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'signin@test.co.uk', organisation: 'Sign In Ltd' }) });
  await drain();
  globalThis.fetch = realFetch;
  assert.ok(teamMail.some(m => m.raw.includes('tracker post FAILED') && m.raw.includes('not a tracker reply')));
}

// client text in a subject cannot forge mail headers
teamMail.length = 0;
r = await call('/signup', { method: 'POST', body: JSON.stringify({ email: 'crlf@test.co.uk', organisation: 'Evil\r\nBcc: victim@example.com' }) });
assert.strictEqual(r.status, 200);
await drain();
{
  const headers = teamMail[0].raw.split('\r\n\r\n')[0]; // the header block, before the body
  const subj = headers.split('\r\n').find(l => l.startsWith('Subject:'));
  assert.ok(subj.includes('Evil') && subj.includes('Bcc: victim')); // flattened INTO the subject text…
  assert.ok(!headers.split('\r\n').some(l => /^bcc:/i.test(l))); // …never a header line of its own
}

// answers the page saves by itself as a booked client leaves ('update') reach
// the dashboard without another team email
teamMail.length = 0;
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'update', answers: { wrong: 'Too slow on phones' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.strictEqual(teamMail.length, 0);
assert.strictEqual(answerOf(ghFile(slug), 'wrong').answer, 'Too slow on phones');

// ── Archived clients ─────────────────────────────────────────────────────
// The dashboard archives a client: deletes their files, appends a history line
// and deletes this worker's KV record. Simulate it for Omar.
const archive = (email, fileSlug, { keepKv = false } = {}) => {
  for (const p of [...gh.files.keys()]) if (p === `clients/${fileSlug}.json` || p.startsWith(`demos/${fileSlug}/`)) gh.files.delete(p);
  const prev = gh.files.has('history/clients.jsonl') ? gh.files.get('history/clients.jsonl').json : '';
  gh.files.set('history/clients.jsonl', { json: prev + JSON.stringify({ archivedAt: '2026-10-07T12:00:00.000Z', email, slug: fileSlug }) + '\n', sha: 'h' + (++gh.n) });
  if (!keepKv) store.delete(`lead:${email}`);
};
archive('omar@kilnworks.co.uk', slug);
// a late answer from the browser that signed up does not bring him back
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, kind: 'update', answers: { feel: 'Late thought' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.ok(!gh.files.has(`clients/${slug}.json`));
assert.ok(!store.get('lead:omar@kilnworks.co.uk'));
// if the archive could not delete the KV record, a late answer still never
// recreates the platform file
assert.ok(gh.files.has('clients/sam-brightpaws-co-uk.json'));
archive('sam@brightpaws.co.uk', 'sam-brightpaws-co-uk', { keepKv: true });
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', token: samToken, kind: 'partial', answers: { feel: 'Late' } }) });
assert.strictEqual(r.status, 200);
await drain();
assert.ok(!gh.files.has('clients/sam-brightpaws-co-uk.json'));
// a returning client who signs up again starts a fresh record; the history stays
r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Omar', lastName: 'Haddad', email: 'omar@kilnworks.co.uk', organisation: 'Kilnworks' }) });
assert.strictEqual(r.status, 200);
await drain();
assert.strictEqual(ghFile(slug).stage, 'signed-up');
assert.strictEqual(answered(ghFile(slug)).length, 0);
assert.strictEqual(gh.files.get('history/clients.jsonl').json.trim().split('\n').length, 2);

console.log('All worker checks passed.');
