---
id: web-design
name: Web Design
version: 3.0.0
triggers: [design, landing page, UI, UX, layout, component, responsive, CSS, Tailwind, website, homepage, dashboard, portfolio, hero section, navigation, user interface, user experience, card, filter, rating, upload, mobile, touch, feed, gallery, badge, category, form, data table, grid, list view, onboarding, settings page]
tags: [design, frontend, css, ui, ux, mobile-first]
tools_required: [read, write, bash]
providers: [ollama, claude, openai, gemini]
estimated_turns: 5-20
---

# Web Design

## Purpose

Design-first frontend development. Establish intent, tokens, and inventory before writing any code, then build with structure, accessibility, and environment-appropriate readability from the start.

The methodology — Intent First → Token System → Inventory → Build → Mandate — is domain-agnostic. The soccer coaching app, the SaaS analytics dashboard, and the e-commerce catalogue all run through the same four phases. Only the vocabulary changes.

---

## PHASE 1 PROPOSE — Intent First

Before writing a single line of code or naming a color, answer these questions:

**The Five Questions:**
1. Who is the user and what is their context? (office knowledge worker? field technician? mobile shopper? dashboard analyst? parent on a phone?)
2. What is the primary action this UI must enable? (find a product? submit a report? monitor a metric? book an appointment? rate a session?)
3. What does success feel like? (fast and confident? deep and precise? calm and trustworthy? playful and engaging?)
4. What domain vocabulary does this world use? (what are the nouns and verbs native to this field?)
5. What makes this different from a generic app? (unusual environment, one-handed use, time pressure, data density, emotional stakes, glove use?)

**Deliverable — Intent Statement (write this before anything else):**
```
This [component/screen] helps [who] to [primary action] so they can [outcome].
It should feel [adjective]. The user is typically [context/environment].
The most important thing to get right is [constraint].
```

**Domain Exploration — produce all four before moving to Phase 2:**
- **Domain vocabulary:** 5–8 concepts native to this domain (not generic UI terms)
- **Color world:** 5 physical objects or environments associated with this domain — what colors do they suggest?
- **Signature element:** one detail that could only exist in this product (not in every other app)
- **Rejecting:** 3 obvious design defaults → what replaces each for this specific domain

**Example applications of Intent First:**

| Domain | Who + context | Signature element | What it rejects |
|---|---|---|---|
| Outdoor gear e-commerce | Buyer on mobile, comparing specs before a purchase | Terrain-type difficulty tag per product (not generic stars) | Uniform product grid → immersive per-category hero layout |
| SaaS analytics dashboard | Data analyst, desktop, multiple monitors | Inline sparkline trend on every numeric metric | Flat table of numbers → annotated time-series with alert thresholds |
| Community coaching platform | Coach or volunteer on a phone, one-handed | Role-based content feed (coach vs. parent vs. player view) | Generic "Post" button → typed action composer (drill / clip / update) |

---

## PHASE 2 TOKEN SYSTEM — Craft Foundations

Define ALL design tokens before writing any component. Tokens are the contract between design and code.

### Naming Convention

Token names must evoke the domain, not describe the color. A reader should infer the product's world from the variable names alone.

| Pattern | Bad (color-named) | Good (domain-evoked) |
|---|---|---|
| Primary action color | `--blue-600` | `--turf`, `--glacier`, `--ember`, `--slate` |
| Page background | `--gray-50` | `--pitch`, `--cloud`, `--parchment`, `--deck` |
| Accent / highlight | `--amber-400` | `--kit`, `--beacon`, `--signal`, `--saffron` |
| Secondary surface | `--gray-100` | `--bench`, `--mist`, `--chalk`, `--dusk` |

**Token Test:** read your variable names out loud. Do they sound like they belong to this product's world? If they could belong to any app, rename them.

### Token Architecture

```css
/* tokens.css — adapt names and values to your domain */
@theme {
  /* Primary brand */
  --color-primary:      oklch(…);   /* main action color — domain-evocative name */
  --color-primary-lt:   oklch(…);   /* lighter variant — hover states */

  /* Secondary */
  --color-secondary:    oklch(…);   /* headers, structural elements */
  --color-secondary-lt: oklch(…);   /* links, info states */

  /* Accent */
  --color-accent:       oklch(…);   /* highlights, ratings, warnings */
  --color-accent-lt:    oklch(…);   /* chip backgrounds, badges */

  /* Neutrals */
  --color-ink:          oklch(…);   /* primary text */
  --color-ink-md:       oklch(…);   /* secondary text, labels */
  --color-ink-lt:       oklch(…);   /* placeholder, disabled */

  /* Canvas */
  --color-canvas:       oklch(…);   /* card backgrounds */
  --color-surface:      oklch(…);   /* page background */
  --color-border:       oklch(…);   /* dividers, borders */

  /* Typography — slightly larger base (15px) for environment readability */
  --text-xs:   0.75rem;             /* 12px — timestamps, metadata */
  --text-sm:   0.875rem;            /* 14px — labels, chips, captions */
  --text-base: 0.9375rem;           /* 15px — body text */
  --text-md:   1.0625rem;           /* 17px — subheadings */
  --text-lg:   1.25rem;             /* 20px — card titles */
  --text-xl:   1.5rem;              /* 24px — section headings */
  --text-2xl:  2rem;                /* 32px — page hero */

  --weight-regular: 400;
  --weight-medium:  500;
  --weight-bold:    700;

  --leading-tight:  1.2;
  --leading-normal: 1.5;
  --leading-loose:  1.75;

  /* Spacing (4px base unit) */
  --space-1:  0.25rem;
  --space-2:  0.5rem;
  --space-3:  0.75rem;
  --space-4:  1rem;
  --space-5:  1.25rem;
  --space-6:  1.5rem;
  --space-8:  2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;                 /* 48px — touch target minimum */
  --space-16: 4rem;

  /* Touch */
  --touch-min:  3rem;               /* 48px — WCAG 2.2 minimum for interactive targets */
  --card-pad:   1rem;
  --card-gap:   0.75rem;
  --section-gap:1.5rem;

  /* Radii */
  --radius-sm:  0.25rem;
  --radius-md:  0.5rem;
  --radius-lg:  0.75rem;
  --radius-xl:  1rem;
  --radius-full: 9999px;            /* pill — filter chips */

  /* Shadows */
  --shadow-sm:  0 1px 2px oklch(0% 0 0 / 0.06);
  --shadow-md:  0 4px 12px oklch(0% 0 0 / 0.10);
  --shadow-lg:  0 8px 24px oklch(0% 0 0 / 0.14);
}
```

### Tailwind v4 Setup

Tailwind v4 is **entirely CSS-based — no `tailwind.config.ts`**.

**vite.config.ts:**
```typescript
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
})
```

**src/index.css:**
```css
@import "tailwindcss";

/* @theme block — Tailwind picks this up automatically, no config file needed */
@theme {
  --color-primary: oklch(…);
  /* … remaining tokens … */
}
```

Tailwind utility classes reference your `@theme` CSS variables automatically. No `theme.extend` config object needed.

---

## PHASE 3 INVENTORY — Component Mapping

Map domain concepts to UI patterns BEFORE writing any code.

### Domain → UI Vocabulary (fill in for your domain)

| Domain concept | UI representation | Key states |
|---|---|---|
| Primary entity (item, record, event) | Card with key attributes | loading, empty, selected |
| Categorization / filtering | Filter chips (horizontal scroll, 48px height) | active, inactive |
| Rating or scoring system | Star or dot row (48px tap zone per element) | interactive, read-only |
| Content with media | Thumbnail card (16:9 ratio) with metadata row | loading skeleton, error |
| Multi-step action | Progressive disclosure (3 taps max to complete) | step 1/2/3, success, error |
| Data collection | Form with labeled fields | default, focus, error, success |
| Status or progress | Badge or progress indicator | pending, in-progress, done, failed |

### Platform Patterns (mobile-first, 375px base)

**Card (generic):**
```
[optional media or icon — 16:9 or square aspect]
[title — bold, 2 lines max, truncated]
[metadata row: date / count / status badge]
[primary action button — full width, 48px min-height]
```

**Filter chips (horizontal scroll, no wrapping):**
```
[All] [Category A] [Category B] [Category C] →
48px height, pill shape, active state clearly distinct
```

**Rating row (1–5, 48px tap zone per element):**
```
[ ★ ][ ★ ][ ★ ][ ☆ ][ ☆ ]   ← each element is a 48×48 button, icon inside
aria-label="Rating: 3 of 5"
```

**Multi-step flow (3 taps max from entry to completion):**
```
[Select / initiate] → [Preview / confirm] → [Processing / done]
No form fields in the critical path. Required info collected beforehand.
```

**List item (dense, text-primary):**
```
[icon or avatar — 40px] [title + subtitle] [trailing action or status]
Full-row tap target ≥ 48px. Divider between rows.
```

### Component Checkpoint — Before Building Each

For each component, answer before writing:
- What data does it consume? (props / API shape)
- What are its states? (loading, empty, error, populated, selected)
- What does the user DO with it? (tap, swipe, rate, fill, submit)
- What's its mobile layout vs. tablet layout?
- What's the accessibility story? (role, aria-label, keyboard nav)

---

## PHASE 4 BUILD — Implementation Rules

### Layout Structure First

Always build in this order:
1. Semantic HTML skeleton — regions only, no content
2. Token-driven base styles — apply tokens, no hardcoded values
3. States — loading skeleton, empty, error, populated
4. Interaction — hover, focus, active, disabled
5. Responsive — base (375px) → sm (640px) → md (768px) → lg (1024px)
6. Accessibility pass — keyboard nav, ARIA, contrast check

### Code Constraints

- **No hardcoded colors** — use `var(--color-primary)` not hex literals
- **No hardcoded px values** — use token variables
- **Touch targets ≥ 48px** — every tappable element, no exceptions
- **Mobile-first** — base styles target 375px, scale up with breakpoints
- **Semantic HTML** — `<button>` for actions, `<a>` for navigation, `<nav>`, `<main>`, `<section>`
- **All four interactive states** — hover, focus-visible, active, disabled on every interactive element
- **No `outline: none`** — always replace with a visible focus ring

### Tailwind v4 Usage

Reference tokens via CSS variables in class names:
```typescript
// CSS variable references in Tailwind classes
className="bg-[var(--color-primary)] text-[var(--color-canvas)]"
className="min-h-[var(--touch-min)] px-[var(--space-4)]"
className="rounded-[var(--radius-lg)] shadow-[var(--shadow-md)]"

// Standard Tailwind utilities still apply where tokens align
className="font-bold leading-tight"
```

---

## THE MANDATE

Before marking any component or slice complete, verify ALL of these:

- [ ] **Intent**: does the UI serve the stated intent statement from Phase 1?
- [ ] **Touch**: every interactive element is ≥ 48px in its smallest dimension
- [ ] **Contrast**: body text ≥ 4.5:1, large text ≥ 3:1 against background (WCAG 2.2 AA)
- [ ] **States**: loading, empty, error, and populated states all render without crash
- [ ] **Keyboard**: Tab order is logical; all interactive elements reachable; no focus traps
- [ ] **Tokens**: zero hardcoded color/size values — all use CSS custom properties
- [ ] **Environment**: mentally place the UI in the user's actual environment (from Phase 1). Is the primary action still immediately obvious?
- [ ] **TypeScript**: `bun run typecheck` passes with zero errors
- [ ] **Build**: `bun run build` succeeds with zero warnings about chunk size

---

## Avoid List

- Generic placeholder content ("Lorem ipsum", "User", "Item 1")
- Hardcoded colors or spacing not in the token system
- Touch targets smaller than 48px on mobile
- Modals or multi-step flows for actions that should be one tap
- Infinite scroll in time-pressured contexts (use paginated or filtered lists)
- Carousel auto-play (users need control)
- `outline: none` without a replacement focus indicator
- Layout shift on image load (always set explicit width/height or aspect-ratio)
- Multiple font families (pick one variable font; use weight + size to create hierarchy)
- Gradients on text (reduces readability at small sizes and in bright environments)
- Low-contrast icons without accompanying text labels
- Deep navigation hierarchies (max 3 taps from home to any primary action)
- Animations > 300ms on interaction responses
- Network calls in the render path (prefetch or cache everything on the critical path)
- Form fields with no visible labels (no placeholder-as-label)
- `justify-content: space-between` in horizontal nav on small screens (use gap instead)
- Importing external fonts in production bundle (host locally or use system font stack)
- Component files > 200 lines (split into subcomponents)
- Any `any` type in TypeScript (use `unknown` and narrow)

---

## Output Format

At each phase boundary, produce:

**Phase 1 complete:**
```
## Intent
[Intent statement]
Five questions answered.
Domain exploration: vocabulary / color world / signature / rejecting.
```

**Phase 2 complete:**
```
## Tokens written
File: src/styles/tokens.css (or design-system/tokens.css)
[key domain-evocative token names listed]
Token test: [pass / rename needed]
```

**Phase 3 complete:**
```
## Inventory
Components to build: [list]
Component checkpoint for [name]: [data / states / action / layout / a11y]
```

**Phase 4 complete:**
```
## Built
[component name] — states: loading ✓ empty ✓ error ✓ populated ✓
Touch targets: all ≥ 48px ✓
TypeScript: clean ✓
```

**Mandate check:**
```
## Mandate
Intent ✓ | Touch ✓ | Contrast ✓ | States ✓ | Keyboard ✓ | Tokens ✓ | Environment ✓ | TS ✓ | Build ✓
```
