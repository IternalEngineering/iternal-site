/* ============================================================
   ISLAND CONTENT — curated from the live site copy.
   This file is the single place to edit island text. Markup uses
   the ip-* classes styled in island.js. Keep every claim identical
   to what the site itself says (case-study pages are intentionally
   not linked anywhere on the site yet, so they are not linked here
   either). UK English.
   ============================================================ */

/* Stations sit on the ring at fixed angles (degrees, clockwise from
   the spawn dock). Walking right moves to the next section in the
   same order as the homepage. The lighthouse sits one step left of
   the dock, exactly like the CTA sits at the end of the page. */
export const STATIONS = [
  {
    id: 'dock',
    angle: 0,
    title: 'Welcome Dock',
    kicker: 'Iternal',
    hint: 'Where you arrived',
    panel: `
      <h3 class="ip-h">We build Agentic AI<br>that actually <span class="ip-warm">works.</span></h3>
      <p class="ip-p">Most AI projects stall between proof-of-concept and production.
      Iternal specialises in the gap, building systems that are
      <strong>live inside the NHS, the Greater London Authority and civic
      infrastructure across three continents.</strong></p>
      <div class="ip-actions">
        <button class="ip-btn" data-island-travel="work">See our work</button>
        <a class="ip-btn-line" href="contact.html">Book a call</a>
      </div>
      <p class="ip-note">Hold &larr; &rarr; (or the edges of the screen) to walk the island.
      The lighthouse is one step to your left.</p>
    `,
  },
  {
    id: 'clients',
    angle: 51.4,
    title: 'Clients Pavilion',
    kicker: 'Trusted by',
    hint: 'Enter the gallery',
    environment: 'gallery',
  },
  {
    id: 'diff',
    angle: 102.9,
    title: 'The Standing Stones',
    kicker: 'What makes us different',
    hint: 'Three things we hold to',
    panel: `
      <h3 class="ip-h">Most agencies charge for headcount.<br>
      <span class="ip-warm">We're built differently.</span></h3>
      <p class="ip-p">Iternal runs a unique AI-augmented delivery model called Forge.
      A small core team, amplified by an internal suite of agentic tools, delivers
      at a capacity most agencies many times our size would struggle to match.</p>
      <div class="ip-pts">
        <div class="ip-pt"><span class="ip-pt-n">01</span><div>
          <div class="ip-pt-h">Agentic, not just generative</div>
          <p class="ip-pt-p">Systems that plan, orchestrate, and deliver outcomes inside real-world infrastructure.</p>
        </div></div>
        <div class="ip-pt"><span class="ip-pt-n">02</span><div>
          <div class="ip-pt-h">Live systems, not pilots</div>
          <p class="ip-pt-p">Good News London launching with the GLA in June. CivicNetZero runs across three continents.</p>
        </div></div>
        <div class="ip-pt"><span class="ip-pt-n">03</span><div>
          <div class="ip-pt-h">Senior team on every project</div>
          <p class="ip-pt-p">The people who scoped it build it. No account management layer, no junior bench.</p>
        </div></div>
      </div>
      <div class="ip-actions">
        <a class="ip-btn-line" href="about.html">About Iternal</a>
      </div>
    `,
  },
  {
    id: 'work',
    angle: 154.3,
    title: 'The Museum',
    kicker: 'Our work',
    hint: 'AI in production',
    panel: `
      <h3 class="ip-h">AI in production,<br>not in PowerPoint.</h3>
      <div class="ip-cases">
        <div class="ip-case">
          <span class="ip-badge">Local Government</span>
          <div class="ip-case-h">Greater London Authority</div>
          <p class="ip-case-p">Pan-London AI platform. Launching June 2026.</p>
        </div>
        <div class="ip-case">
          <img src="assets/screenshot-civicnetzero.png" alt="CivicNetZero platform" class="ip-case-img" loading="lazy">
          <span class="ip-badge">Civic Innovation</span>
          <div class="ip-case-h">CivicNetZero</div>
          <p class="ip-case-p">First-of-its-kind platform identifying city climate projects and connecting
          them with delivery partners and finance. Live across multiple city networks.</p>
        </div>
        <div class="ip-case">
          <img src="assets/screenshot-bplaced.png" alt="bPlaced platform" class="ip-case-img" loading="lazy">
          <span class="ip-badge">Welfare</span>
          <div class="ip-case-h">bPlaced: Smarter Care</div>
          <p class="ip-case-p">Connecting local authorities with care providers for better, faster placements for young people.</p>
        </div>
        <div class="ip-case">
          <img src="assets/screenshot-nhs.png" alt="Bristol Children's Hospital — Digital Diary" class="ip-case-img" loading="lazy">
          <span class="ip-badge">Health</span>
          <div class="ip-case-h">Bristol Children's Hospital</div>
          <p class="ip-case-p">Supporting parents of sick children. Co-designed with clinicians, full NHS security compliance.</p>
        </div>
        <div class="ip-case">
          <span class="ip-badge">Social Impact</span>
          <div class="ip-case-h">Tech4Good South West</div>
          <p class="ip-case-p">AI advisory for industry-leading Living Labs programmes with Age UK and others.</p>
        </div>
      </div>
      <div class="ip-actions">
        <a class="ip-btn-line" href="services.html#cases">View all</a>
      </div>
    `,
  },
  {
    id: 'svcs',
    angle: 205.7,
    title: 'The Three Workshops',
    kicker: 'What we do',
    hint: 'Three ways to work with us',
    panel: `
      <h3 class="ip-h">Three ways to work<br>with Iternal.</h3>
      <div class="ip-svcs">
        <div class="ip-svc"><span class="ip-pt-n">01</span><div>
          <div class="ip-pt-h">Agentic AI Builds</div>
          <p class="ip-pt-p">End-to-end design and delivery of production agentic AI systems, from brief
          to live deployment, including security compliance and full stack integration.</p>
          <div class="ip-tags"><span class="ip-tag">Autonomous workflow systems</span><span class="ip-tag">AI-powered civic platforms</span><span class="ip-tag">Multi-agent orchestration</span><span class="ip-tag">RAG and knowledge systems</span></div>
        </div></div>
        <div class="ip-svc"><span class="ip-pt-n">02</span><div>
          <div class="ip-pt-h">AI Strategy &amp; Advisory</div>
          <p class="ip-pt-p">Sprint engagements and fractional advisory for leadership teams navigating the
          shift to AI-first operations. Make the right decisions before committing to a build.</p>
          <div class="ip-tags"><span class="ip-tag">AI readiness assessments</span><span class="ip-tag">Board-level AI strategy</span><span class="ip-tag">Vendor and platform selection</span><span class="ip-tag">Team capability building</span></div>
        </div></div>
        <div class="ip-svc"><span class="ip-pt-n">03</span><div>
          <div class="ip-pt-h">AI Augmentation</div>
          <p class="ip-pt-p">Embed Iternal's augmented delivery model inside your team. We install the tools,
          workflows and agent infrastructure so your people operate at a level they couldn't reach alone.</p>
          <div class="ip-tags"><span class="ip-tag">Internal agent deployment</span><span class="ip-tag">Team workflow automation</span><span class="ip-tag">AI toolchain setup</span><span class="ip-tag">Ongoing support</span></div>
        </div></div>
      </div>
      <div class="ip-actions">
        <a class="ip-btn" href="services.html">Learn more</a>
      </div>
    `,
  },
  {
    id: 'insights',
    angle: 257.1,
    title: 'The Reading Room',
    kicker: 'Insights',
    hint: 'Ideas worth reading',
    panel: `
      <h3 class="ip-h">Ideas worth reading.</h3>
      <div class="ip-ideas">
        <div class="ip-idea">
          <div class="ip-idea-meta"><span class="ip-tag">Agentic AI</span><span class="ip-idea-date">February 2026</span></div>
          <div class="ip-pt-h">Why &ldquo;agentic&rdquo; is not just a marketing word, and how to tell when it is</div>
          <p class="ip-pt-p">The word &ldquo;agentic&rdquo; is everywhere. Most of what's called agentic AI is still just
          generative AI with a longer prompt. Here's how to tell the difference, and why it matters
          for anyone commissioning AI work.</p>
        </div>
        <div class="ip-idea">
          <div class="ip-idea-meta"><span class="ip-tag">Delivery Model</span><span class="ip-idea-date">January 2026</span></div>
          <div class="ip-pt-h">The 10&times; team: how AI augmentation is changing what a small agency can deliver</div>
          <p class="ip-pt-p">We've built an internal delivery model called Forge that lets a small team operate at
          the capacity of an agency many times its size. This is how it works, and what it means for
          the economics of building with AI.</p>
        </div>
      </div>
      <div class="ip-actions">
        <a class="ip-btn-line" href="insights.html">All insights</a>
      </div>
    `,
  },
  {
    id: 'cta',
    angle: 308.6,
    title: 'The Lighthouse',
    kicker: 'Get in touch',
    hint: 'The beacon',
    panel: `
      <h3 class="ip-h">If you're building something that needs AI done
      <span class="ip-warm">properly</span>, let's talk.</h3>
      <p class="ip-p">We usually have space for one or two new client engagements each quarter.
      Discovery calls are 30 minutes, focused and free. If there's a fit, we'll tell you quickly.
      If there isn't, we'll tell you that too.</p>
      <div class="ip-actions">
        <a class="ip-btn" href="contact.html">Book a Discovery Call</a>
        <a class="ip-btn-line" href="mailto:hello@iternal.life">Or email us directly</a>
      </div>
      <p class="ip-note">We respond to all enquiries within one working day.</p>
    `,
  },
];

/* Gallery pieces — the six organisations from the clients strip.
   Only what the site itself says: where a client has homepage case
   copy it is reused verbatim; where it has a sector label only
   (Kew Gardens, First Bank UK) the plaque stays name + sector. */
export const GALLERY_ITEMS = [
  {
    name: 'NHS',
    sector: 'Health & MedTech',
    heading: "Bristol Children's Hospital",
    body: 'Supporting parents of sick children. Co-designed with clinicians, full NHS security compliance.',
    image: 'assets/screenshot-nhs.png',
    imageAlt: "Bristol Children's Hospital — Digital Diary",
  },
  {
    name: 'Kew Gardens',
    sector: 'Science & Research',
  },
  {
    name: 'GLA',
    sector: 'Local Government',
    heading: 'Greater London Authority',
    body: 'Pan-London AI platform. Launching June 2026.',
  },
  {
    name: 'CivicNetZero',
    sector: 'Civic Innovation',
    heading: 'CivicNetZero',
    body: 'First-of-its-kind platform identifying city climate projects and connecting them with delivery partners and finance. Live across multiple city networks.',
    image: 'assets/screenshot-civicnetzero.png',
    imageAlt: 'CivicNetZero platform',
  },
  {
    name: 'bPlaced',
    sector: 'Social Care',
    heading: 'bPlaced: Smarter Care',
    body: 'Connecting local authorities with care providers for better, faster placements for young people.',
    image: 'assets/screenshot-bplaced.png',
    imageAlt: 'bPlaced platform',
  },
  {
    name: 'First Bank UK',
    sector: 'Financial Services',
  },
];

export const GALLERY_LABEL = "Trusted by organisations who can't afford to get AI wrong";

/* Which station you arrive at, per page. */
export const PAGE_SPAWN = {
  'index': 'dock',
  'about': 'diff',
  'services': 'svcs',
  'insights': 'insights',
  'contact': 'cta',
  'case-good-news-london': 'work',
  'case-nhs': 'work',
  'case-civicnetzero': 'work',
  'case-bplaced': 'work',
  'case-tech4good': 'work',
};
