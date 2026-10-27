# Site changes — running log

What a visitor would notice, page by page, from the site as it stood at the start of the
October 2026 design pass to now. Newest first within each part. Every visible change gets
a line here in the same commit; when a deploy goes out, its lines move from "Waiting" to
"Live" under that date. The commit is in brackets for anyone who wants the detail.

Last deploy: **22 Oct 2026, the website rework** (pull request #6; pushing to main deploys the site automatically). Local copy: `http://localhost:8734`.

---

## Waiting to deploy (in the repo, not yet on iternal.co.uk)

#### Website sign-up (still hidden)
- **The final terms are in**: the Iternal Website Build and Care Terms, version 1.0 (23
  clauses, word for word as supplied, page and PDF, with "Site Agent" where the supplied text
  said "web agent"), replace the earlier draft. "Review and
  accept" now follows the team's walkthrough: "Order summary" (Name or business name, the
  £750 build fee as £100 now and £650 on completion), "Key points of our terms" (nine
  points), "Read the full terms" in a pop-up with the PDF, and the new second tick ("buying
  this website mainly for my work"). The sign-up's Organisation field is now "Name or
  business name". (stripe-bookings)
- **The downpayment is paid straight after accepting**, as in the team's client journey:
  "Review and accept" ends with "Accept and pay £100", which opens a Stripe payment page
  made for the order (their reference shown, billing address, optional VAT number, a VAT
  invoice from Stripe). Paid, they land on the questions page with "Thank you, your payment
  has been received."; back without paying, their order is still there to accept and pay.
  The sign-up's steps read Sign up, Review and accept, Pay your downpayment, Your
  questions, Book your call. Booking the call takes no payment. (stripe-bookings)
- **The client's one email moves to after payment**: "Welcome to Iternal: your website order
  is confirmed", worded as the team's sign-up example, with the booking link and the terms
  attached (it was sent on accepting). (stripe-bookings)

---

## Live

### 22 Oct 2026, the website rework (pull request #6)

The website rework (pull request #6, merged from `website-rework`): phase 1 rearranged or
removed existing content; the Site Agent and AEO audit sections are the only new copy.

**For this release, Websites stays hidden**: the Services entry and the homepage row are
in the pages but hidden, and the contact form has no Websites option, until the website
sign-up launches. The Websites lines below describe the launch-day state.

#### Whole site
- **No "Built with Forge" line in the footer** (Forge is explained on About). (rebuild 24)
- **Case studies lead somewhere**: each case's top link goes to its service (Agentic AI Builds,
  or AI Strategy & Advisory for Tech4Good) instead of "Back to Work", and each closes with
  "Next case: …" beside "See more work". (rebuild 24)
- **Service buttons pre-fill the contact form**: arriving from a service page (or AI
  Augmentation on the homepage) selects that service in "What kind of engagement?". (rebuild 24)
- **The menu says "Services"** (was "What We Do"), and Insights is gone from the menu, the
  mobile menu and the footer. The footer no longer links to iternal.app, and its
  "Get in touch" goes to the contact page from every page. (rebuild 1)
- **Calmer motion on every page.** Sections fade in rather than sliding in from the sides
  or zooming; hero text no longer drifts and fades as you scroll; the soft colour shapes in
  the background stand still. The particle network behind the hero stays. (rebuild 10)
- **Nothing moves on its own except the particle network.** Sections no longer fade in as
  you scroll (everything is simply there), hero text no longer animates in, the homepage
  headline appears whole instead of word by word, and cards no longer tilt towards the
  mouse (homepage work, Services). Hover colour changes stay. (rebuild 11)
- **The footer gives the company number**: "Iternal Ltd · Company no. 10849262 · Bristol,
  UK" (the search data already carried it; the site audit asked for it on the page). (rebuild 11)

#### Services
- **AI Augmentation is a service everywhere, not just on the homepage**: its own page
  (/ai-augmentation, with the four points the homepage card first listed), a row on the Services
  hub under the four AI services, an option on the contact form, and llms.txt and the sitemap.
  On the homepage it now sits with the AI services and opens its page. (rebuild 26)
- **Builds uses the homepage's case titles** (Good News London, CivicNetZero, bPlaced: Smarter
  Care); the AEO box spells out "answer engine optimisation" and its button is the outline
  style; /websites gets the "All services" link and clean /start links. (rebuild 24)
- **Each case study sits with its service, not on the Services hub**: Agentic AI Builds
  shows the GLA, CivicNetZero, bPlaced and Bristol Children's Hospital, two by two; AI
  Strategy & Advisory shows Tech4Good, with room beside it for the First Bank and Covers
  work. The hub no longer carries a hidden copy. (rebuild 21; hidden in rebuild 20)
- **Site Agent is named as our agentic studio** on AI Automations and in the Tech4Good
  gallery caption ("through Site Agent, our agentic studio"). (rebuild 21)
- **The AEO audit is a single offer box** on AI Strategy & Advisory: the heading, one sentence
  and "Ask about an AEO audit" (was a paragraph and six points). (rebuild 20)
- **The workshop no longer shows a price**: "AI Discovery Workshop: fixed price" on its card
  and page, and the £2,500 figure is gone from the booking box, search descriptions and
  llms.txt. (rebuild 19)
- **AI Automations features Site Agent**: an AI assistant that updates the text and images on
  a client's own site from plain-English requests, with "Talk to us about Site Agent". New
  copy, the first in the overhaul, at Robbie's request. (rebuild 19)
- **AI Strategy & Advisory opens with "Start with an AEO audit"**: how AI assistants see
  your organisation, what the audit checks and the scored report, with "Ask about an AEO
  audit". New copy, at Robbie's request. (rebuild 19)
- **Each service opens its own page**, and Services becomes the hub: five short cards (name,
  one sentence, price), each opening its page when clicked anywhere. The pages carry the full
  description, price and list of points that the cards had trimmed, all existing copy:
  /workshops-training (with "Start with the AI Discovery Workshop" in full), /ai-automations,
  /agentic-ai-builds (with the GLA, CivicNetZero and bPlaced case studies and "We're Claude
  and OpenAI specialists", both moved off the hub), /ai-strategy-advisory; Websites opens
  /websites. The hub keeps the process, every case study, sectors and the FAQ; its "Or book a
  Workshop first" goes to the workshops page. The homepage rows open the pages directly; the
  sitemap and llms.txt list them. (rebuild 18)
- **The service cards are shorter and sit four across on a laptop** (two on a tablet, one on
  a phone, where they had been squeezed into two thin columns): one sentence each, three
  points each, and the "Core offer" and "Strategic" labels are gone ("Starting point" and
  "Most requested" stay). The Websites entry keeps its first sentence and both buttons. (rebuild 14)
- **Websites joins the four service cards as one block**, a full-width row under them
  instead of a separate box below a gap. (rebuild 15)
- **The Discovery Workshop section is half the height** (587px from 1,133px on a laptop):
  the paragraph saying what it is (the "most organisations know…" lead-in is gone), what you
  leave with as a plain list instead of four boxes, the four steps by name and timing
  without their descriptions, and the price box without its repeated title. (rebuild 16)
- **Websites is visible**: a wide entry under the four AI services, with "See the websites
  we've made" (the gallery) and "Build a site with us" (sign-up, still in preview: banner
  up, nothing sent). The process section now says "Every AI engagement". The homepage
  gets a Websites row in "Ways to work", and the contact form a "Website" option. Links
  that jump to a section (homepage and Services) now stop below the menu. (rebuild 13)
- **One list of ways to work, cheapest first**: Workshops & Training, AI Automations &
  Assistants, Agentic AI Builds, AI Strategy & Advisory, each with its typical price
  (moved up from the FAQ, which now points to them). Advisory's two lists are merged
  into one. (rebuild 2)
- **The hero has one button, "Book a Discovery Call"**, and every booking button goes
  to the contact page instead of jumping down the page. (rebuild 2)
- **Sections run in one direction**: services, the workshop, the process, the work,
  models, sectors, FAQ. (rebuild 2)
- **Shorter.** The FAQ keeps the three questions the page doesn't already answer
  (getting burned before, security and compliance, how soon we can start); Agentic AI
  Builds and AI Strategy & Advisory list their five strongest points (were seven and
  nine). The closing glow no longer pulses. (rebuild 10)
- **The "Learn More" buttons on the service cards can be clicked**: a hover glow sat
  on top of them. (rebuild 3)

#### Homepage
- **A line under the headline says what agentic AI is** ("systems that plan, reason and
  execute across your real infrastructure, not just generate text", from the Builds page), and
  Tech4Good joins the client strip. The first screen still ends with the strip on laptops,
  short ones included. (rebuild 24)
- **"Ways to work" is tighter**: each row is about 80px on a laptop (was 107–132px), with
  less padding, a wider description so most fit on two lines, and a slightly smaller name;
  the section is 774px from 988px. (rebuild 17)
- **Runs hero, clients, "Ways to work with Iternal", the work, then the call to
  action.** "Ways to work" (was "Three ways") is one short row per service, each linking
  to that service on the Services page; AI Augmentation stays as a fifth row, linking to
  the contact page. Its "Learn More" buttons can now be clicked (the same hover glow
  covered them). (rebuild 3)
- **The closing glow no longer pulses.** (rebuild 10; the client names keep scrolling past,
  as Robbie asked on 22 Oct, and stand still for visitors who ask for reduced motion)
- **The Forge section ("Most agencies charge for headcount") moved to About**, and the
  "Ideas worth reading" teasers are gone. The work section loses its "View All"
  button. (rebuild 3)

#### About
- **"See our services"** joins the closing buttons. (rebuild 24)
- **Says "AI consultancy"** (was "AI agency") under the hero. (rebuild 3)
- **The Forge section replaces "Our operating principles"**, and "From first
  conversation to live system" is gone (the process is on Services). (rebuild 3)
- **The Forge rings stand still.** (rebuild 10)
- **"The people behind the work" is gone**, with its four named cards, until it returns
  as Wiseall and the named board members. Its search description no longer says "Meet the
  people", and llms.txt no longer lists the team. (rebuild 7)

#### Contact
- **The dropdown says "Websites"** and the thank-you message points to "our services". (rebuild 24)
- **"Good reasons to reach out" sits beside the form** (above it on a phone) instead of
  below it. (rebuild 4)
- **"What kind of engagement?" lists the services by their names on the Services
  page**: Workshops & Training, AI Automations & Assistants, Agentic AI Builds, AI
  Strategy & Advisory, or not sure yet. (rebuild 4)

- **The form has a second, stronger spam trap**: an off-screen field people never see. If a
  bot fills it, nothing is sent and the bot sees the normal "Message sent" screen.
  FormSubmit's own trap stays too. (rebuild 8)

#### Large screens
- **Everything is drawn at 95% on laptops and larger screens** (100% read as oversized,
  90% as too small); phones and tablets are unchanged. The column keeps its width and the
  homepage's first screen still ends with the client strip. (rebuild 9)
- **Pages use more of a wide screen**: the content column grows with the window, from
  1160px up to 1440px (no change on a laptop). Case-study and other long paragraphs keep
  their reading width. On Services, the four service cards sit in one row from 1700px
  wide, and the closing call to action on the homepage and Services takes three lines
  instead of four. (rebuild 6)

#### Behind the pages
- **The four AI service pages carry Service structured data**; the go-live checklist adds
  Websites to llms.txt on launch day. The website sign-up's "Book your call" now opens the
  website-build calendar (John's, 60 minutes) instead of Paul's. (rebuild 24)
- **Search and AI descriptions use the same four service names**: the Services page's
  search description, and llms.txt (Enterprise Strategy and Consultancy & Advisory are
  one entry, AI Strategy & Advisory). The sitemap no longer lists Insights, and its
  unpublished article says "small consultancy" (was "small agency"). (rebuild 5)
- **Insights stays out of search** (noindex) until it has articles; llms.txt gives the
  Companies House number; the logos on the website pages reserve their space while
  loading. (rebuild 11)
- **llms.txt names the co-founders**: Tom Ilube CBE, Tim Campbell MBE and Paul Wiseall FRSA.
  (rebuild 8)

### 20 Oct 2026, third deploy (version f85a948c)

The funnel is still dark (preview banner up).

#### Sign-up page (still hidden from the public)
- **The build fee reads "£100 downpayment + £650 upon completion, including VAT"** on "Review
  and accept" (was "£750 + VAT. 50% now, 50% on completion"), and so do the client's
  emailed copy and the team's brief, which now says to invoice the downpayment. The
  page's search description no longer gives prices. (downpayment)
- **The care plan reads "£50 per month including VAT"** (was "+ VAT"), on "Review and
  accept" and in the client's copy; payable monthly, quarterly, half-yearly or annually as
  before. (care plan VAT)

### 20 Oct 2026, second deploy (version a0b7490d)

#### Whole site (AI-readiness fixes from the site audit, branch aeo-audit-fixes)
- **Page titles say which Iternal this is.** Every title now ends "Iternal, Bristol AI
  consultancy" instead of "Iternal AI", and the homepage reads "Iternal, Bristol AI
  consultancy — We Build AI That Works". Link previews show "Iternal" as the site name.
  (aeo-audit-fixes)
- **Menu and footer links go straight to the page** (/about rather than about.html, which
  redirected). Nothing looks different. (aeo-audit-fixes)
- **Services: model names no longer carry version numbers.** The model cards read "Opus ·
  Sonnet · Haiku" and "OpenAI GPT" with "GPT · reasoning models · OpenAI API", and the FAQ
  asks "Claude or GPT?". (aeo-audit-fixes)
- **Contact: "Last name" loses its asterisk** (it was never required), and screen readers now
  hear which budget is selected. (aeo-audit-fixes)
- Not visible: canonical tags, link-preview URLs, structured data, the sitemap and robots.txt
  now name iternal.co.uk instead of iternal.life; the organisation's structured data carries
  its company number; security headers and /.well-known/security.txt are new. (aeo-audit-fixes)

### 20 Oct 2026, first deploy (version d4847422)

Deployed automatically when main was pushed. The funnel is still dark.

#### Sign-up page and websites gallery (still hidden from the public)
- **The questions don't repeat the sign-up.** The questions page no longer asks for the
  work email, and skips "Do you have a website today?" when they gave a website at sign-up
  (it is still asked if they left that blank). The essentials count follows: "The first
  three unlock your call booking" (or four). (sign-up not repeated)
- **The sign-up fits one screen on laptops.** On desktop and laptop screens the sign-up
  form, and the "Review and accept" screen after it, tighten their spacing to fit the
  height of the window, down to the smallest common laptop (about 650px of browser
  window); shorter windows scroll. On a tall screen nothing changes. The jump to "Review
  and accept" now lands with its heading clear of the menu bar. Phones are unchanged.
  (fit to screen)
- **Every screen can be stepped through before launch.** The sign-up and questions
  pages carry a gold banner, "Sign-ups and call bookings aren't live yet." (it used to say
  "In testing — sign-ups aren't open yet", with Sign Up greyed out). Sign Up now goes on
  to "Review and accept", even with nothing filled in, showing an example order; accepting
  goes on to the questions; the call booking shows without the five essentials; sending
  shows the thank-you screen. Nothing is sent and no call is booked (the booking button
  does nothing). Goes when the section goes public. (preview)
- **Our contact address in error messages is now john@iternal.life** (was
  websites@iternal.life), on the sign-up and questions pages. (preview)
- **Review and accept our terms.** After signing up, the visitor sees "Review and accept":
  their order details in a table (company, name, email, a reference, the build fee of £750
  + VAT with half now and half on completion, the care plan of £50 a month + VAT, and the
  Website Build and Care Terms, version 1.0, to view or download) and two boxes to tick:
  that they have read and accept the terms and the order, and that they are authorised to
  accept for their organisation, acting in the course of its business. "Accept and
  continue" works only once both are ticked; it records the acceptance, emails them a copy
  and takes them to their questions. The wording comes with the terms, word for word. It
  replaces "The engagement at a glance" (the £100-to-begin, studio and "If no concept fits"
  cards and its tick). Organisation and last name are now required, because the order
  names them. (terms acceptance)
- **The terms have their own page**, `terms/website-build-and-care-v1.0.html`, with a PDF
  to download. Not indexed. (terms acceptance)
- **No prices on the gallery page.** "How it works" and "Our studio, built in" are gone,
  and the page's descriptions no longer give prices; "After something bigger?" stays.
  (gallery pricing removed)
- **The sign-up page's steps say "Review and accept"**, and its intro no longer promises
  refining the site "until it's yours" (the terms include one round of revisions). (terms
  acceptance)

#### Questions page (still hidden from the public)
- **"Your answers are saved as you go."** The intro now says so: answers are saved to the
  team's dashboard whenever the visitor leaves the page, from the first answer, so someone
  who stops part-way can be followed up. (prospect progress)

### 7 Oct 2026, third deploy (version 8fb2c0c7)

#### Whole site
- **No more "one or two new clients a quarter" or "if there's a fit".** The homepage and What
  We Do closing sections, the Contact intro, the What We Do FAQ and the summary for AI
  assistants (llms.txt) no longer state how many clients Iternal takes on or set Iternal up
  as deciding who qualifies. They now invite people to say what they're working on, with a
  straight answer on how Iternal would approach it. What We Do's closing heading is now
  "Tell us what you're working on." (capacity wording)
- **"We aim to" respond within one working day, instead of a promise.** Contact (its intro
  box, the "Message sent" confirmation and its search and share descriptions), the
  homepage and What We Do closing notes, llms.txt, and the hidden sign-up and questions
  pages. (response-time wording)

#### Questions page (still hidden from the public)
- **The optional questions say they matter.** Once the essentials are answered, the booking
  panel said "That's enough for us to prepare" and the optional section said "skip the
  rest". The panel now says the questions below shape the first version built for the
  call, and the section opens "These shape the design." (optional questions wording)

### 7 Oct 2026, second deploy (version 4e40a7ae)

#### Whole site
- **Orange buttons are readable.** "Book a call", "See Our Work", "Send Message" and the
  rest had white text on the orange-to-gold gradient (3.4:1 down to 2.2:1); the text is
  now near-black navy in both themes (5.6:1 to 8.7:1). The mobile menu's button no longer
  turns orange-on-orange when tapped, and it and the keyboard-only "Skip to content" link
  are navy in light mode too. (round-three fixes, consistency pass)
- **Every inner page's headline starts at the same place and size.** About, Contact and the
  sign-up pages started 64px left of the content below and used 80–112px headlines; they
  now line up with What We Do, Insights and the case studies at 72px. The homepage keeps its
  larger headline. (consistency pass)
- **The last pages are on the same spacing.** Contact, Privacy, the Insights footer and the
  websites gallery now use the same gaps as the rest of the site (about 127px between
  sections, about 150px before the footer). (consistency pass)
- **Links shared on LinkedIn, Slack or email show a preview.** Every page pointed at a share
  image that did not exist; there is now a 1200×630 card (the homepage headline on navy)
  at iternal.co.uk/og-image.png. (round-three fixes)
- **Pages load much faster.** The site screenshots are WebP instead of PNG: the homepage's
  drop from 3.3MB to 0.34MB and the websites gallery's from 6.4MB to 0.66MB, with no
  visible loss. (round-three fixes)

#### Homepage
- **"Case study" sits level across each row of project cards**, at the bottom of every
  card. (round-three fixes)
- **"that actually" in the headline is readable in light mode** (2.1:1 before).
  (round-three fixes)

#### What We Do and About
- **The big faint numbers are gone.** The process steps and the operating principles had
  52–68px numerals at about 1.2:1 that read as smudges; they are now small orange labels
  ("01", "02"…). (round-three fixes)
- **About's hero matches What We Do's.** "Small team. Outsized impact." filled the whole
  screen with a "Scroll to explore" cue; it is now the same height, size and alignment as
  the What We Do hero, so "Built on a simple premise" shows on arrival. (consistency pass)

#### Sign-up and questions (still hidden from the public)
- **Headlines no longer sit flush against the paragraph** (28px, as on Contact), and the
  faint middle words ("your", "you book") are readable in light mode (2.1:1 before).
  (consistency pass)

#### Contact
- **"about your" in the headline is readable in light mode** (2.1:1 before). (round-three
  fixes)

#### Websites gallery (still hidden from the public)
- **No bot-check screenshots.** The weekly refresh had captured CivicNetZero's Cloudflare
  "security verification" page and a YouTube "not a bot" prompt over Jay's Transport; both
  are fresh, correct captures again, and the weekly job now skips any capture showing a bot
  check and keeps last week's instead. (round-three fixes)

### 7 Oct 2026

#### Fixes
- **About, bPlaced and CivicNetZero show their content again.** Before this deploy these
  three pages were blank below the menu: leftover merge markers from 10 September stopped each
  page's script from running, so nothing faded in. (7c41b43)
- **Insights footer logo is the right size.** It rendered about 1,200px wide and pushed the
  footer links off-screen. Its footer columns and "Built with Forge" line now match the other
  pages too. (e926d81, round-two fixes)

#### Whole site
- **Light theme is readable.** Body text and labels were too faint for anyone whose computer
  is set to light mode (3.6:1 and 2.4:1 contrast); they are now about 6:1 and 5:1.
  (round-two fixes)
- **No sideways wobble on phones.** Content that slides in from the side made pages 10px
  wider than a phone screen; pages now stay put. (round-two fixes)
- **Closing headings break evenly**, so no single word ends up alone on a line (About's
  "Ready to operate at / a / different scale?"). (round-two fixes)
- **Even, tighter spacing between sections.** The blank space between one section and the
  next was 180–280px depending on the page; it is now about 127px everywhere (about 150px
  around the closing call to action). Pages are 190–710px shorter on a laptop. Applies to the
  homepage, What We Do, About, Insights, the five case studies and the websites gallery;
  Contact is unchanged. (abf2123)

#### Homepage
- **Shorter hero, so the client list shows on arrival.** "Trusted by organisations…" is
  visible without scrolling on every common screen size, phones included. The headline
  scales a little with screen height; the scroll arrow is gone. (ac9f478)
- **The delivery-model section fits one screen.** "Most agencies charge for headcount" was
  1,080px tall at every size; the copy column is wider and the three points run as a row
  underneath. The faint "10×" behind the headline is gone: it read as a smudge and was never
  explained. Same words otherwise. (e59a678, round-two fixes)
- **Project section about 11% wider, same card heights**, on screens 1240px and wider. The
  headline, cards and closing line widen together, so they line up with each other. The
  Good News London screenshot shifts up slightly so its own headline is not cut in half.
  (dd3f878, round-two fixes)
- **Project tags restyled and moved off the screenshots.** The sector labels ("Local
  Government", "Health"…) were square navy blocks sitting on each screenshot's own menu bar;
  they are now small rounded tags in the card, level with "Case study", so they never cover
  the screenshot. (8702fb6, round-two fixes)
- **Client names are readable.** The "Trusted by" names were the faintest text on the page;
  they are now as clear as body text. (round-two fixes)
- **Articles say "Coming soon"** instead of "Read Article" links that led nowhere, here and on
  Insights. (round-two fixes)

#### What We Do
- **Hero aligned and shorter.** It started 64px left of everything below it; it now lines
  up, and "Five ways to work with Iternal" shows on arrival. (1b3f9bb)
- **Less padding** between sections and inside the service cards. (1b3f9bb)
- **"Most requested" and the tool chips are rounded pills**, matching the homepage tags.
  (1b3f9bb)
- **Sector emoji replaced by line icons** (building, heart with pulse, pound, leaf) in each
  column's accent colour. (1b3f9bb)
- **FAQ divided by thin lines** instead of six boxes. (1b3f9bb)

#### Contact
- **The intro no longer sits flush against "next build."**: 28px between the headline and
  the paragraph. (round-two fixes)

#### Websites gallery (still hidden from the public)
- **The sample sites pan slowly behind the header.** Two tilted rows of the gallery's own
  screenshots drift in opposite directions on the right, kept clear of the headline and
  intro; a single strip on phones; still for anyone who has reduced motion switched on.
  Built from the gallery, so a new site appears there automatically. (f6e1a5f, round-two
  fixes)

### 1 Oct 2026
- **Websites gallery and sign-up: pricing.** £750 all in: £100 for the call and an initial
  build, the remaining £650 only if the client decides to go ahead. (3a16704)
- **No claim that every site comes with the studio**; the self-editing studio is now
  mentioned as an extra ("Our studio, built in"), priced separately. (3811084, 57b1ee2)
- **No promised number of concepts.** "Two or three" removed everywhere; the client is shown
  them instead. (57b1ee2)
- **Sign-up and questions**: the reworked questions, no payment at booking, sign-up sent
  straight to the funnel. Websites gallery: bPlaced, Jay's Transport and CivicNetZero
  added; sites open in a lightbox. All of this sits behind the hidden funnel. (29 Sep–1 Oct)
