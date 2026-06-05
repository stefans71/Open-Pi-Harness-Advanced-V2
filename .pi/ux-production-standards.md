# UX Production Standards — Vanilla HTML/CSS/JS

> Measurable design rules for single-file component generation and review.
> Each rule has a threshold. Violations cite the rule ID and failing CSS selector.
> Used by the dictionary-enhanced benchmark workflow for generation context and structured review.

---

## SPACING (SP)

- **SP-01** Section Gap: 48–64px between major sections, 24–32px between subsections.
- **SP-02** Card Padding: min 24px on content cards. Never below 16px.
- **SP-03** Text-to-Edge: text never closer than 16px to container edge.
- **SP-04** 8px Grid: all spacing values from {4, 8, 12, 16, 24, 32, 48, 64}px. Odd values like 13px or 37px break rhythm.
- **SP-05** Interactive Gap: adjacent buttons/links/inputs have min 8px gap.
- **SP-06** Vertical Rhythm: margins between paragraphs/items use consistent multiplier of base spacing.

## TYPOGRAPHY (TY)

- **TY-01** Heading Scale: each level 1.25–2x the next level down. H1→H2 never less than 1.25x.
- **TY-02** Body Line-Height: 1.5–1.6x font-size for body text. 1.3–1.4x only for labels/badges.
- **TY-03** Max Line Width: prose text max 75 characters (~600px at 16px). Use max-width.
- **TY-04** Caption Ratio: labels/captions 0.75–0.875x of body size. Never same as body.
- **TY-05** Weight Contrast: headings 600–700. Body 400. If everything is same weight, hierarchy is invisible.
- **TY-06** Font Stack: system font stack or loaded font. Never reference unloaded fonts without explicit fallback.
- **TY-07** Unit Consistency: all font sizes use same unit (rem or px). Don't mix.
- **TY-08** Display Size: prices and hero headlines must be ≥ 48px (3rem). Use `clamp(2.5rem, 5vw, 3.5rem)` for responsive display text. Only the PRICE VALUE ($49, $0, $9) gets display size — plan names (Pro, Free, Enterprise) stay at 18-24px as secondary labels above the price. Only applies to components WITH prices or hero text — NOT to buttons, nav bars, or toolbars.

## INTERACTIVE STATES (IS)

- **IS-01** Hover: every clickable element has visible hover state. Transition ≤150ms.
- **IS-02** Focus-Visible: all interactive elements have focus-visible style — min 2px outline, high contrast, 2px offset. Never `outline: none` without replacement.
- **IS-03** Active/Pressed: buttons show pressed state — scale(0.97–0.98) or 10% darken.
- **IS-04** Disabled: 40–50% opacity, cursor: not-allowed. Show as unavailable, don't hide.
- **IS-05** Transition Timing: 150–200ms ease-out. Never instant, never >300ms.
- **IS-06** Cursor: pointer on clickable non-buttons. Default on non-interactive.
- **IS-07** Touch Targets: min 44x44px hit area on interactive elements (48px preferred).

## COLOR & CONTRAST (CC)

- **CC-01** Text Contrast: WCAG AA — 4.5:1 body, 3:1 large text (≥18px bold or ≥24px).
- **CC-02** Accent Limit: max 3 accent colors in any single viewport.
- **CC-03** Meaning + Shape: never color alone for status. Pair with icon or text label.
- **CC-04** Layer Separation: surface → canvas → elevated with min 5% luminance difference.
- **CC-05** Subtle Borders: structural borders at 10–15% opacity. Heavy 1px solid looks dated.

## VISUAL DEPTH (VD)

- **VD-01** Shadow System: one consistent shadow system. Same-elevation elements share same shadow.
- **VD-02** Z-Order: modals > dropdowns > sticky headers > floating buttons > cards > surface.
- **VD-03** Glassmorphism: if used — backdrop-filter blur(12–20px), bg opacity 0.6–0.8, 1px border at 10–20% white. Without backdrop-filter it's not glass.
- **VD-04** Consistent Radii: 2–3 border-radius values used everywhere. No random 3px/7px/15px.
- **VD-05** Visible Card Elevation: cards must be visually distinct from the background at arm's length. Shadow spread ≥ 8px, opacity ≥ 0.08. If you squint and the card blends into the page, the shadow is too weak.

## ANIMATION (AM)

- **AM-01** Enter: fade + translateY(8–16px), 200–300ms ease-out. Stagger lists 50–80ms.
- **AM-02** Exit Speed: exit/close 150–200ms — faster than enter.
- **AM-03** Reduced Motion: `@media (prefers-reduced-motion: reduce)` disables/simplifies all animation.
- **AM-04** Purposeful Only: animation communicates state change. No decorative-only pulsing/spinning on idle.
- **AM-05** GPU Properties: animate transform and opacity only. Never animate width, height, margin, padding.

## LAYOUT (LS)

- **LS-01** Squint Test: primary element identifiable within 2 seconds. Blur the page — can you tell what's most important?
- **LS-02** Grid Consistency: one grid system per view. Don't mix.
- **LS-03** Above-Fold Impact: primary content and action visible at 1920x1080 without scrolling.
- **LS-04** Responsive: base styles for 375px. @media for 768px and 1024px. No horizontal overflow at 375px.
- **LS-05** Density Balance: if cards are too dense to read at normal zoom, use progressive disclosure.
- **LS-06** Active Navigation: active tab/nav item visually distinct — bold, underline, background, or color accent.
- **LS-07** CTA Contrast: the primary CTA button must be the highest-contrast colored element. Use a saturated color (indigo #5046E5, blue #2563EB, green #059669) that pops against the background. Teal, gray, and pastels are too weak for primary CTAs.

## COMPONENT PATTERNS (CP)

- **CP-01** Table: alternating rows OR dividers (not both). Header visually distinct. Min 40px row height.
- **CP-02** Tabs: active indicator visible. Panels actually switch content. ARIA: role="tablist", role="tab" with aria-selected, role="tabpanel" with aria-labelledby.
- **CP-03** Empty States: sections that can be empty show icon + message + action. Never blank.
- **CP-04** Modal: semi-transparent backdrop, centered, visible close button, Escape to close.
- **CP-05** Pricing Card Flow: plan name → price → divider → features → CTA. Price immediately follows plan name with no tagline between them. Price amount and period on same baseline (`display: flex; align-items: baseline`). Tagline goes below the divider or is omitted. Never use `<br>` for text wrapping — use `max-width` instead.

## COLOR DIRECTION (CD)

- **CD-01** Follow the Prompt: if the prompt specifies a color scheme (dark, light, white, specific colors), use it. Do not default to dark theme unless the prompt asks for it or the domain strongly implies it (terminal, IDE, monitoring dashboard).
- **CD-02** No Default AI Purple: avoid the generic AI-tool palette (dark bg + purple accents + purple glow). Every product has its own color world. A recipe app is warm. A finance dashboard is blue/green. A fitness tracker is energetic. Purple is only correct when the domain calls for it.
- **CD-03** Reference Real Design Systems: for dark themes use established palettes — Vercel (near-black + white + minimal blue), Cloudflare (charcoal + orange), Linear (navy + purple-blue), GitHub (dark gray + green + blue), Stripe (indigo + cyan). Pick the reference closest to the prompt's domain.
- **CD-04** Light Theme Defaults: for light themes start from white (#fff) or warm white (#fafafa). Dark text (#111). ONE saturated accent color. Shadows for depth (not glow). Gray borders (#e5e7eb). Most SaaS products are light-themed.

## CRAFT & POLISH (CR)

- **CR-01** SVG Icons: use inline `<svg>` for icons — checkmarks, arrows, close buttons, status indicators. Never emoji or text characters (✓ ✗ →). SVGs scale, color with `currentColor`, and look sharp at any size.
- **CR-02** Multi-Layer Shadows: stack 2–3 `box-shadow` values for realistic depth — ambient (large blur, low opacity), direct (medium blur, medium opacity), edge highlight (1px inset white at 5–15% opacity).
- **CR-03** Ambient Glow: use `radial-gradient` on body or container for atmospheric lighting. Place gradient center near the primary element. Subtle — opacity 0.08–0.16.
- **CR-04** Display Typography: large text (≥32px) benefits from negative letter-spacing (-0.02 to -0.04em). Tightens headlines for a premium feel. Never on body text.
- **CR-05** Hover Lift: buttons/cards hover with `translateY(-1px)` or `translateY(-2px)` + shadow expansion. Press with `translateY(0)` + shadow reduction. Creates physical feel.
- **CR-06** Opacity Layers: use `rgba()` or `color-mix()` for borders, overlays, and surface tints instead of flat hex. Enables transparent layering: `border: 1px solid rgba(255,255,255,0.12)` adapts to any background.
- **CR-07** Text Safety: long content needs `word-break: break-word` on feature lists, `text-overflow: ellipsis` with `overflow: hidden` on single-line labels, `-webkit-line-clamp` on multi-line truncation.
- **CR-08** Success Icons Green: checkmark/success/included icons use green (#10B981 or similar), not the theme accent color. Green = "yes/included" is universal. Purple checkmarks on a purple card lose semantic meaning.
- **CR-09** Glow Behind Not Through: glow/aura effects use `::before` or outer `box-shadow` with opacity 0.15–0.35. The card SURFACE must be a solid, clean background — no glow bleeding through the face. Glow sits on the outer edge/border only. If the prompt asks for a glow, it must be visible (not 0.05 opacity).
- **CR-10** Solid Headings: plan names, product titles, and primary headings use solid text color (white or near-white on dark, dark on light). No gradient text fills unless the prompt specifically requests it. Gradient text competes with the price/CTA for attention.
