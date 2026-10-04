# Agentic OS — design system

All values live in [`src/styles/tokens.css`](src/styles/tokens.css). Components only read tokens.
To see everything at once, open `#/lab`. It shows each theme side by side.

## Idea
The OS is organised around **Earth time**. The background is the planet, lit by the real sun.
Every piece of information is placed in time or space:
- the clock is a 24-hour sun dial;
- the news sits on the map;
- the status bar shows Berlin's coordinates and the sun's elevation.

The boldness is spent on the **world backdrop** and the **Chronosphere**. Everything else stays quiet: hairlines, a cut panel corner, plenty of space.

## Themes (`data-theme` on `<html>`)
| Theme | Base | Accent | Character |
|---|---|---|---|
| Orbital (default) | `#05070A` | cyan `#4FE3FF` | Territory Studio / TRON. Glow, scanlines |
| Ember | `#080808` | orange `#FF5A1F` | Nothing OS / Teenage Engineering. No blur, no glow |
| Aurora | `#07060B` | violet `#8B7CFF` | visionOS glass. Heavy blur, soft light |

Semantic tokens are the same in every theme:
- `--void` page, `--hull`/`--hull-2` surfaces, `--seam`/`--seam-strong` hairlines
- `--ink`/`--ink-2`/`--ink-3` text
- `--signal` primary, `--pulse` ok, `--amber` warning, `--flare` alert

## Continent tones
`--tone-europe|africa|asia|mideast|namerica|samerica|oceania` are all `oklch(~.76 ~.11 h)`. Lightness and chroma stay the same and only the hue changes, so no region shouts.
- They are used for map dots, news, world-clock cities and AI vendors.
- Full strength is for dots and markers. Fills use 15–30% via `color-mix`.

## Type
- **Space Grotesk**: UI and headings. Large sizes use weight 300 with negative tracking.
- **JetBrains Mono**: data only (times, counts, coordinates). Everywhere uses `tabular-nums`.
- **Doto**: dot-matrix digits for the clock and timer (Orbital and Ember). Aurora uses Space Grotesk.
- Scale is 1.25, base 15px. Labels are sentence case. Uppercase micro text is reserved for data readouts (`.micro`).

## Shape
- **Radius has a hierarchy:**
  - chips `--r-pill`
  - controls `--r-sm` (4px)
  - cards inside panels `--r-md`
  - the mobile dock `--r-lg`
- **Panels have no radius.** They get a 12px chamfer on the top-right, plus two corner brackets in `--signal`.
- **Panel outline:** an SVG drawn by `components/panel.js`. It draws itself in, once per navigation.

## Elevation and surface
Stacked from back to front:
1. Hairline (`--seam`) plus an inner top edge (`--panel-edge`).
2. Backdrop blur, set per theme by `--panel-blur`.
3. Glow (`--glow`), only for the primary button hover, live items and the active nav.
4. Ambient body layers: a 24px dot grid, scanlines (Orbital only) and SVG grain at 4.5%.

## Buttons
| State | Look |
|---|---|
| Rest | hairline border |
| Hover | border tints to the signal colour and a light sweep crosses once |
| Press | `scale(.97)`, plus an optional synthesized tick sound |
| Focus | 2px signal outline, 2px offset |
| Disabled | 45% opacity and diagonal stripes |

## Motion
- **Timing:** `--t-fast 120ms` (feedback), `--t-base 220ms` (state), `--t-slow 480ms` (enter), `--t-draw 650ms` (panel outline). `--ease-spring` is used for toggles and toasts.
- **Ambient (no user action):**
  - the boot sequence, once per day;
  - the map sweeping in;
  - pings for news;
  - the clock's second ring.
- **Never animate:** layout properties.
- **Reduced motion:** both `prefers-reduced-motion` and Settings → Motion → Calm zero the durations.

## Signature components
- **World backdrop** (`components/backdrop.js`):
  - pre-sampled dot map (`npm run world-dots`)
  - real subsolar point, twilight falloff, city lights on the night side
  - terminator line, noon meridian band, Berlin crosshair, region-tinted news pings
  - Static layer: redrawn every 60s. Live layer: ≤40fps desktop and ≤24fps phone, paused when hidden.
- **Chronosphere** (`components/chronosphere.js`):
  - 24h dial with midnight at the bottom
  - suncalc daylight ring for Berlin, today's agenda as arcs
  - week, month and year progress
  - 60-segment seconds ring
- **Calendar** (`views/calendar.js`):
  - time grid with tinted blocks and a 2px source-colour edge
  - red now-line with a time pill
  - chrono-node quick add

## Don'ts
- No new colours outside the tokens. No second accent per theme.
- No identical-card grids: panels differ in content density and purpose.
- No uppercase headings. No `→` on buttons.
- No glow on body text.

## Screen sizes (`styles/responsive.css`)
| Width / height | Layout |
|---|---|
| ≤ 860px | Phone: dock, single column, Garmin tiles scroll sideways |
| 861–1440px wide **or** ≤ 900px tall | Laptop density: 64px rail, 44px status bar, 16px panel padding, the clock scales with window height so Home's panels start in the first screen |
| ≤ 720px tall | Icon-only rail (browser chrome on a 768px laptop) |
| ≥ 1680px | Wide canvas (1760px, 2080px from 2300px); Home uses 4 columns |

Home picks its column count in JS (`views/home.js`, 1–4) so panels are redistributed, not just squeezed.

## Captures
Everything typed into a capture box lands **unsorted**. Type colours: note `--tone-europe`, task `--signal`, habit `--tone-samerica`, goal `--tone-oceania`, calendar `--amber`, meeting `--tone-asia`.
