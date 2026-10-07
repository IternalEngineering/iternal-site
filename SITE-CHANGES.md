# Site changes — running log

What a visitor would notice, page by page, from the site as it stood at the start of the
October 2026 design pass to now. Newest first within each part. Every visible change gets
a line here in the same commit; when a deploy goes out, its lines move from "Waiting" to
"Live" under that date. The commit is in brackets for anyone who wants the detail.

Last deploy: **1 Oct 2026** (version 28d2f96d). Local copy: `http://localhost:8734`.

---

## Waiting to deploy (in the repo, not yet on iternal.co.uk)

### Fixes
- **About, bPlaced and CivicNetZero show their content again.** On the live site these
  three pages are blank below the menu: leftover merge markers from 10 September stop each
  page's script from running, so nothing fades in. (7c41b43)
- **Insights footer logo is the right size.** It rendered about 1,200px wide and pushed the
  footer links off-screen. Its footer columns and "Built with Forge" line now match the other
  pages too. (e926d81, round-two fixes)

### Whole site
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

### Homepage
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

### What We Do
- **Hero aligned and shorter.** It started 64px left of everything below it; it now lines
  up, and "Five ways to work with Iternal" shows on arrival. (1b3f9bb)
- **Less padding** between sections and inside the service cards. (1b3f9bb)
- **"Most requested" and the tool chips are rounded pills**, matching the homepage tags.
  (1b3f9bb)
- **Sector emoji replaced by line icons** (building, heart with pulse, pound, leaf) in each
  column's accent colour. (1b3f9bb)
- **FAQ divided by thin lines** instead of six boxes. (1b3f9bb)

### Contact
- **The intro no longer sits flush against "next build."**: 28px between the headline and
  the paragraph. (round-two fixes)

### Websites gallery (still hidden from the public)
- **The sample sites pan slowly behind the header.** Two tilted rows of the gallery's own
  screenshots drift in opposite directions on the right, kept clear of the headline and
  intro; a single strip on phones; still for anyone who has reduced motion switched on.
  Built from the gallery, so a new site appears there automatically. (f6e1a5f, round-two
  fixes)

---

## Live

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
