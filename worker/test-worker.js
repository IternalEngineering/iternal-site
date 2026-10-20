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
  CLIENT_REPLY_TO: 'john@iternal.life',
  SITE_URL: 'https://iternal.co.uk',
  FROM_EMAIL: 'Website Pipeline <funnel@iternal.co.uk>',
  TEAM_EMAIL: 'paul@iternal.life',
  LEAD_API_URL: 'https://script.example/exec',
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
  if (String(url).endsWith('.pdf')) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }); // the published terms
  outbound.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return new Response('{}', { status: 200 });
};

const pending = [];
const ctx = { waitUntil(p) { pending.push(p); } };
const call = (path, init) => worker.fetch(new Request('https://w.example' + path, init), env, ctx);
const drain = () => Promise.allSettled(pending.splice(0));

// health + 404 + CORS preflight
assert.strictEqual((await call('/health')).status, 200);
assert.strictEqual((await call('/nope')).status, 404);
const pre = await call('/answers', { method: 'OPTIONS' });
assert.strictEqual(pre.status, 204);
assert.strictEqual(pre.headers.get('access-control-allow-origin'), env.SITE_URL);

// the old Stripe route is gone
let r = await call('/stripe-webhook', { method: 'POST', body: '{}' });
assert.strictEqual(r.status, 404);
assert.strictEqual(store.size, 0);

// answers with an email: stored on the lead record and briefed to the team;
// the tracker never receives answers
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'Sam@BrightPaws.co.uk', kind: 'complete', answers: { mainJob: 'Take bookings', audience: 'gift buyers', pages: ['Home', 'Contact'] } }) });
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
assert.deepStrictEqual({ ...omarOrder, reference: 'x' }, { company: 'Kilnworks', name: 'Omar Haddad', email: 'omar@kilnworks.co.uk', reference: 'x', buildFee: 750, carePlan: 50, termsVersion: '1.0' });
assert.match(omarOrder.reference, /^WB-\d{4}-[A-HJ-NP-Z2-9]{4}$/);
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
const accept = (extra = {}) => call('/accept', { method: 'POST', body: JSON.stringify({ email: 'omar@kilnworks.co.uk', token: omarToken, termsVersion: '1.0', accepted: true, authorised: true, ...extra }) });
teamMail.length = 0; outbound = [];
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
// accepted: the record keeps exactly what they saw
r = await accept();
assert.strictEqual(r.status, 200);
await drain();
{
  const acc = JSON.parse(store.get('lead:omar@kilnworks.co.uk')).acceptance;
  assert.deepStrictEqual({ ...acc, acceptedAt: 'x' }, { ...omarOrder, acceptedAt: 'x' });
  assert.ok(Date.parse(acc.acceptedAt));
  const f = ghFile(slug);
  assert.deepStrictEqual(f.acceptance, acc); // on the dashboard too
  assert.strictEqual(f.progress.step, 'terms-agreed');
  // the client gets the copy the terms promise, with the terms attached
  assert.strictEqual(clientMail.length, 1);
  const m = clientMail[0];
  assert.strictEqual(m.to, 'omar@kilnworks.co.uk');
  assert.deepStrictEqual(m.from, { name: 'Iternal', email: 'websites@iternal.co.uk' });
  assert.strictEqual(m.replyTo, 'john@iternal.life');
  assert.ok(m.subject.includes(acc.reference));
  assert.ok(m.text.startsWith('Hello Omar,'));
  assert.ok(m.text.includes('Company: Kilnworks\nYour name: Omar Haddad\nEmail: omar@kilnworks.co.uk\nReference: ' + acc.reference));
  assert.ok(m.text.includes('Build fee: £750 + VAT. 50% now, 50% on completion'));
  assert.ok(m.text.includes('Care plan: £50 per month + VAT, from the month after your site goes live. Payable monthly, quarterly, half-yearly or annually in advance'));
  assert.ok(m.text.includes('https://iternal.co.uk/terms/website-build-and-care-v1.0.html'));
  assert.strictEqual(m.attachments[0].type, 'application/pdf');
  assert.strictEqual(m.attachments[0].content.byteLength, 4);
  // the team is told to invoice the first half; the tracker gets a note, never answers
  const brief = teamMail.find(t => t.raw.includes('Subject: Website Pipeline: terms accepted — Kilnworks'));
  assert.ok(brief && brief.raw.includes('(£375 + VAT) is payable now: send the invoice'));
  const note = outbound.find(o => o.url.includes('action=createLead'));
  assert.ok(note.body.message.includes('Accepted the Website Build and Care Terms, version 1.0 (reference ' + acc.reference + ')'));
  assert.ok(!('answers' in note.body));
}
// accepting again changes nothing and sends nothing
teamMail.length = 0; clientMail.length = 0; outbound = [];
{
  const before = store.get('lead:omar@kilnworks.co.uk');
  assert.strictEqual((await accept()).status, 200);
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
// when the copy cannot go, the team gets it to forward: never silent
{
  const sendBefore = env.CLIENT_MAIL.send;
  env.CLIENT_MAIL.send = async () => { throw Object.assign(new Error('Domain not onboarded'), { code: 'E_SENDER_DOMAIN_NOT_AVAILABLE' }); };
  r = await call('/signup', { method: 'POST', body: JSON.stringify({ firstName: 'Ana', lastName: 'Silva', email: 'ana@tidewater.co.uk', organisation: 'Tidewater' }) });
  const { token } = await r.json();
  teamMail.length = 0;
  r = await call('/accept', { method: 'POST', body: JSON.stringify({ email: 'ana@tidewater.co.uk', token, termsVersion: '1.0', accepted: true, authorised: true }) });
  assert.strictEqual(r.status, 200); // she has accepted; the failure is ours to handle
  await drain();
  env.CLIENT_MAIL.send = sendBefore;
  const failMail = teamMail.find(t => t.raw.includes('client copy FAILED — Tidewater'));
  assert.ok(failMail && failMail.raw.includes('Domain not onboarded') && failMail.raw.includes('Forward the text below to ana@tidewater.co.uk'));
  assert.ok(failMail.raw.includes('Build fee: £750 + VAT. 50% now, 50% on completion'));
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
// a record with no token (made before this check) still accepts answers
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', kind: 'partial', answers: { pages: ['Home'] } }) });
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
r = await call('/answers', { method: 'POST', body: JSON.stringify({ email: 'sam@brightpaws.co.uk', kind: 'partial', answers: { feel: 'Late' } }) });
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
