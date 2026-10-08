# Site changes — running log

What a visitor would notice, page by page, from the site as it stood at the start of the
October 2026 design pass to now. Newest first within each part. Every visible change gets
a line here in the same commit; when a deploy goes out, its lines move from "Waiting" to
"Live" under that date. The commit is in brackets for anyone who wants the detail.

Last deploy: **7 Oct 2026, third deploy** (version 8fb2c0c7). Local copy: `http://localhost:8734`.

---

## Waiting to deploy (in the repo, not yet on iternal.co.uk)

#### Whole site
- **Search engines and link previews are told the site lives at iternal.co.uk.** Every page
  named iternal.life as its official address (the canonical tag, the address used when a
  link is shared, and the details search engines read on the homepage, the Websites page
  and the five case studies), while iternal.life itself redirects to iternal.co.uk. They
  now all name iternal.co.uk, using the clean addresses the site already serves (`/about`,
  not `/about.html`). The sitemap and robots.txt point at iternal.co.uk too, and the sitemap
  now lists the five case studies. Nothing changes on the pages themselves. Email addresses
  are unchanged. (canonical domain)

---

## Live

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
