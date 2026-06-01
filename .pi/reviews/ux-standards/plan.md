# Plan: Professional UX Standards — Dictionary Architecture

## Summary

Add professional UX/UI standards to the web-design workflow via a "dictionary of patterns" — concrete, copy-paste-ready code examples that small local LLMs (4-8B parameters) can follow exactly. Standards are keyed to the user's css_approach profile preference.

**Files changed:**
| File | Action |
|------|--------|
| `.pi/ux-dictionary.md` | NEW — static source of truth, 2 concrete approach sections (~350 lines) |
| `.pi/workflows/web-design.yaml` | MODIFY — 1 new node + 4 modified nodes |

**Node count:** 24 (was 23, +1 resolve-dictionary)

## Architecture

```
.pi/ux-dictionary.md          (static, checked into repo)
  ├── [approach:tailwind]      — 11 complete patterns with TSX code
  └── [approach:css_modules]   — 11 complete patterns with CSS code
                ↓
resolve-dictionary (bash)      — extracts matching section based on user profile
  ├── tailwind / you_decide  → tailwind section
  ├── css_modules            → css_modules section
  ├── vanilla_css            → css_modules section + adaptation note
  └── styled_components      → tailwind section + adaptation note
                ↓
$ARTIFACTS_DIR/ux-patterns.md  (approach-specific, compact)
                ↓
tokens, inventory, implement, review  (read from numbered lists)
```

---

## New File: `.pi/ux-dictionary.md`

Create this file at `.pi/ux-dictionary.md`:

```markdown
# UX Pattern Dictionary

Professional UX patterns for the web-design workflow. The resolve-dictionary node
extracts the section matching the user's css_approach into ux-patterns.md.

---

## [approach:tailwind]

### button-states
When: every interactive button.
```tsx
<button
  type="button"
  className={cn(
    "inline-flex min-h-12 items-center justify-center rounded-xl px-5 py-2",
    "text-[length:var(--text-button)] font-semibold",
    "bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm",
    "transition duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:bg-[var(--color-primary-lt)] hover:shadow-md",
    "active:bg-[var(--color-primary-dk)] active:shadow-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
    "disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-ink-muted)]",
    "motion-reduce:transition-none"
  )}
  disabled={false}
>
  Continue
</button>
```
Size scale: sm=h-8/px-3/text-sm, md=h-10/px-4, lg=h-12/px-5 (lg default on mobile).
Native `disabled` on `<button>`. Never `aria-disabled` on native controls.

### card-elevation
When: clickable cards, tiles. NOT static info cards.
```tsx
<a
  href="#"
  className={cn(
    "block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-8)]",
    "shadow-[var(--shadow-md)]",
    "transition duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
    "motion-reduce:transform-none motion-reduce:transition-none"
  )}
>
  <h3 className="text-[length:var(--text-h3)] font-semibold text-[var(--color-ink)]">Title</h3>
  <p className="mt-[var(--space-2)] text-[length:var(--text-body)] text-[var(--color-ink-muted)]">Description</p>
</a>
```
Static/info cards: shadow-md, no hover, no transition.

### skeleton-pulse
When: loading placeholders. Match final layout dimensions.
```tsx
<div className="space-y-[var(--space-3)]">
  <div className="h-6 w-40 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-canvas)] motion-reduce:animate-none" />
  <div className="h-4 w-full animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" />
  <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" />
</div>
```
Always pair `animate-pulse` with `motion-reduce:animate-none`.

### focus-ring
When: every interactive element — buttons, inputs, links, cards, tabs.
```
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
```
NEVER use `outline-none` alone. NEVER suppress focus-visible.

### form-controls
When: text inputs, selects, textareas.
```tsx
<div className="space-y-[var(--space-1)]">
  <label className="text-[length:var(--text-caption)] font-medium text-[var(--color-ink)]">
    Email address
  </label>
  <input
    type="email"
    className={cn(
      "min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]",
      "bg-[var(--color-canvas)] px-[var(--space-3)] text-[length:var(--text-body)] text-[var(--color-ink)]",
      "shadow-sm transition duration-[var(--duration-fast)] ease-[var(--ease-out)]",
      "placeholder:text-[var(--color-ink-muted)]",
      "hover:border-[var(--color-ink-muted)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
      "disabled:cursor-not-allowed disabled:bg-[var(--color-surface)] disabled:text-[var(--color-ink-muted)]",
      "aria-[invalid=true]:border-[var(--color-error)]",
      "motion-reduce:transition-none"
    )}
    placeholder="you@example.com"
  />
  <p className="text-[length:var(--text-caption)] text-[var(--color-error)]">
    Please enter a valid email address.
  </p>
</div>
```
Height: min-h-11 (44px) default, min-h-12 (48px) primary mobile.
Label above with --space-1 gap. Error text with --color-error.
Select: same sizing + border. Textarea: same border/focus, min rows 3.

### responsive-container
When: page sections and content wrappers.
```tsx
<section className="mx-auto w-full max-w-[var(--content-max)] px-[var(--space-4)] md:px-[var(--space-6)]">
  <div className="mx-auto max-w-[var(--prose-max)]">
    <h1 className="text-[length:var(--text-h1)] font-bold tracking-tight text-[var(--color-ink)]">
      Dashboard
    </h1>
  </div>
</section>
```
Base = mobile (375px). md: and lg: for larger screens. No horizontal overflow.

### touch-target
When: icon buttons, tabs, tappable items.
```tsx
<button
  type="button"
  className={cn(
    "inline-flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-md)]",
    "text-[var(--color-ink)] transition duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
    "motion-reduce:transition-none"
  )}
  aria-label="Open filters"
>
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" />
</button>
```
min-h-12 + min-w-12 = 48px. aria-label required on icon-only buttons.

### reduced-motion
When: any animated/transitioning element.
```
"motion-reduce:transform-none motion-reduce:transition-none motion-reduce:animate-none"
```
Add to every element using animate-*, transition, or hover:-translate-*.

### disabled-native-vs-aria
Native `<button>`, `<input>`, `<select>`, `<textarea>` → use `disabled` attribute:
```tsx
<button disabled className="... disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-ink-muted)]">
```
Custom non-native controls → use `aria-disabled="true"`:
```tsx
<div role="button" aria-disabled="true" tabIndex={-1} className="... opacity-60 cursor-not-allowed pointer-events-none">
```

### color-contrast
Use only token pairings, never ad-hoc colors:
```tsx
<h2 className="text-[var(--color-ink)]">Title</h2>
<p className="text-[var(--color-ink-muted)]">Subtitle</p>
<span className="rounded-full bg-[var(--color-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-warning-fg)]">
  Warning
</span>
```
Semantic feedback: use paired --color-{status}-fg and --color-{status}-bg tokens.

### sticky-header
When: app shell with fixed navigation.
```tsx
<header className={cn(
  "sticky top-0 z-[var(--z-sticky)] h-[var(--space-16)]",
  "flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm",
  "px-[var(--space-4)] md:px-[var(--space-6)]"
)}>
  <nav className="flex items-center gap-[var(--space-6)]">{/* items */}</nav>
</header>
```
Use z-[var(--z-sticky)], nav height = --space-16 (64px).

---

## [approach:css_modules]

### button-states
```tsx
import styles from './Button.module.css';
<button type="button" className={cn(styles.button, styles[variant])} disabled={false}>
  Continue
</button>
```
```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-min);
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: var(--text-button);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
  transition: all var(--duration-fast) var(--ease-out);
}
.button:hover { background: var(--color-primary-lt); box-shadow: var(--shadow-md); }
.button:active { background: var(--color-primary-dk); box-shadow: none; }
.button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
.button:disabled {
  background: var(--color-border);
  color: var(--color-ink-muted);
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .button { transition: none; }
}
```

### card-elevation
```css
.card {
  padding: var(--space-8);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-canvas);
  box-shadow: var(--shadow-md);
}
.interactive {
  transition: all var(--duration-fast) var(--ease-out);
}
.interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
.interactive:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
@media (prefers-reduced-motion: reduce) {
  .interactive { transition: none; transform: none; }
}
```

### skeleton-pulse
```css
.skeleton {
  background: var(--color-canvas);
  border-radius: var(--radius-md);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
```

### focus-ring
```css
.focusable:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
```

### form-controls
```css
.field {
  min-height: 2.75rem;
  width: 100%;
  border-radius: var(--radius-md);
  border: var(--border-1) solid var(--color-border);
  background: var(--color-canvas);
  padding: 0 var(--space-3);
  font-size: var(--text-body);
  color: var(--color-ink);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.field::placeholder { color: var(--color-ink-muted); }
.field:hover { border-color: var(--color-ink-muted); }
.field:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
.field:disabled {
  background: var(--color-surface);
  color: var(--color-ink-muted);
  cursor: not-allowed;
}
.field[aria-invalid="true"] { border-color: var(--color-error); }
.label { font-size: var(--text-caption); font-weight: 500; color: var(--color-ink); }
.error { font-size: var(--text-caption); color: var(--color-error); }
@media (prefers-reduced-motion: reduce) {
  .field { transition: none; }
}
```

### responsive-container
```css
.container {
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--space-4);
}
@media (min-width: 768px) { .container { padding: 0 var(--space-6); } }
.prose { max-width: var(--prose-max); margin: 0 auto; }
```

### touch-target
```css
.iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--touch-min);
  min-width: var(--touch-min);
  border-radius: var(--radius-md);
  color: var(--color-ink);
  transition: background-color var(--duration-fast) var(--ease-out);
}
.iconButton:hover { background: var(--color-surface); }
.iconButton:active { background: var(--color-border); }
.iconButton:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
@media (prefers-reduced-motion: reduce) {
  .iconButton { transition: none; }
}
```

### reduced-motion
```css
@media (prefers-reduced-motion: reduce) {
  .animated { animation: none; }
  .transitioning { transition: none; transform: none; }
}
```

### disabled-native-vs-aria
Native controls use `:disabled`:
```css
.button:disabled, .field:disabled {
  background: var(--color-border);
  color: var(--color-ink-muted);
  cursor: not-allowed;
}
```
Custom controls: `.disabled { opacity: 0.6; cursor: not-allowed; pointer-events: none; }`

### color-contrast
Use token pairings only:
```css
.heading { color: var(--color-ink); }
.muted { color: var(--color-ink-muted); }
.badgeWarning {
  background: var(--color-warning-bg);
  color: var(--color-warning-fg);
}
```

### sticky-header
```css
.header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  height: var(--space-16);
  display: flex;
  align-items: center;
  border-bottom: var(--border-1) solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 95%, transparent);
  backdrop-filter: blur(4px);
  padding: 0 var(--space-4);
}
@media (min-width: 768px) { .header { padding: 0 var(--space-6); } }
```
```

---

## New Node: resolve-dictionary

Insert AFTER save-profile, BEFORE brief in web-design.yaml:

```yaml
  - id: resolve-dictionary
    type: bash
    command: |
      APPROACH="tailwind"
      if [ -f "$ARTIFACTS_DIR/user-profile.json" ]; then
        DETECTED=$(node -e "
          const p = JSON.parse(require('fs').readFileSync('$ARTIFACTS_DIR/user-profile.json','utf8'));
          console.log(p.preferences?.css_approach || 'tailwind');
        " 2>/dev/null)
        if [ -n "$DETECTED" ]; then APPROACH="$DETECTED"; fi
      fi

      case "$APPROACH" in
        tailwind|you_decide)  SECTION="tailwind" ; NOTE="" ;;
        css_modules)          SECTION="css_modules" ; NOTE="" ;;
        vanilla_css)          SECTION="css_modules" ; NOTE="NOTE: These patterns use CSS Modules syntax. For vanilla CSS, replace module imports with global BEM-prefixed classes (e.g., .ui-button). All CSS custom properties and @media queries are identical.\n\n" ;;
        styled_components)    SECTION="tailwind" ; NOTE="NOTE: These patterns use Tailwind utilities in JSX className strings. For styled-components, convert each utility to its CSS property equivalent in a styled template literal. Example: className=\"min-h-12 rounded-xl px-5\" becomes styled.button\`min-height: var(--touch-min); border-radius: var(--radius-md); padding: 0 var(--space-5);\`. Focus rings, transitions, and reduced-motion rules use the same CSS properties.\n\n" ;;
        *)                    SECTION="tailwind" ; NOTE="" ;;
      esac

      DICT=".pi/ux-dictionary.md"
      if [ ! -f "$DICT" ]; then
        echo "ERROR: .pi/ux-dictionary.md not found"
        exit 1
      fi

      if [ -n "$NOTE" ]; then
        printf "$NOTE" > "$ARTIFACTS_DIR/ux-patterns.md"
      else
        : > "$ARTIFACTS_DIR/ux-patterns.md"
      fi

      awk -v section="$SECTION" '
        /^\#\# \[approach:/ {
          if (index($0, "[approach:" section "]")) { found=1; next }
          else { found=0 }
        }
        found { print }
      ' "$DICT" >> "$ARTIFACTS_DIR/ux-patterns.md"

      LINES=$(wc -l < "$ARTIFACTS_DIR/ux-patterns.md")
      if [ "$LINES" -lt 5 ]; then
        echo "WARNING: Only $LINES lines for $SECTION — falling back to tailwind"
        : > "$ARTIFACTS_DIR/ux-patterns.md"
        awk '
          /^\#\# \[approach:tailwind\]/ { found=1; next }
          /^\#\# \[approach:/ { found=0 }
          found { print }
        ' "$DICT" > "$ARTIFACTS_DIR/ux-patterns.md"
        LINES=$(wc -l < "$ARTIFACTS_DIR/ux-patterns.md")
      fi

      echo "Resolved $LINES lines of UX patterns for: $APPROACH (section: $SECTION)"
```

No `allow_failure`. Missing file = exit 1 = workflow stops. Empty extraction = Tailwind fallback.

---

## Modified Nodes

### tokens node

**Add to read list** (after current item 3):
```yaml
        4. $ARTIFACTS_DIR/ux-patterns.md   - code examples for this css_approach
```

**Replace** the current "ALSO DEFINE:" section (the 5 bullet points about typography, spacing, touch target, radius, shadows) with:

```yaml
      TYPOGRAPHY SCALE (define ALL in tokens.css):
        | Token          | Size             | Line-height      | Weight |
        |----------------|------------------|------------------|--------|
        | --text-h1      | 2.25rem (36px)   | 2.75rem (44px)   | 700    |
        | --text-h2      | 1.75rem (28px)   | 2.25rem (36px)   | 700    |
        | --text-h3      | 1.25rem (20px)   | 1.75rem (28px)   | 600    |
        | --text-body    | 1rem (16px)      | 1.5rem (24px)    | 400    |
        | --text-button  | 0.9375rem (15px) | 1.25rem (20px)   | 600    |
        | --text-caption | 0.875rem (14px)  | 1.25rem (20px)   | 400    |
        Copy widths: --prose-max: 42rem (672px), --content-max: 80rem (1280px)

      SPACING SCALE (define ALL in tokens.css, 8px grid):
        | Token      | Value | Token      | Value |
        |------------|-------|------------|-------|
        | --space-1  | 4px   | --space-6  | 24px  |
        | --space-2  | 8px   | --space-8  | 32px  |
        | --space-3  | 12px  | --space-10 | 40px  |
        | --space-4  | 16px  | --space-12 | 48px  |
        | --space-5  | 20px  | --space-16 | 64px  |

      MOTION TOKENS (define ALL in tokens.css):
        | Token              | Value                        |
        |--------------------|------------------------------|
        | --duration-fast    | 150ms                        |
        | --duration-normal  | 200ms                        |
        | --duration-slow    | 300ms                        |
        | --ease-out         | cubic-bezier(0, 0, 0.2, 1)   |
        | --ease-in-out      | cubic-bezier(0.4, 0, 0.2, 1) |
        | --skeleton-pulse   | 1.5s ease-in-out infinite     |

      LAYER TOKENS:
        --z-sticky: 100, --z-popover: 400, --z-modal: 500

      ALSO DEFINE:
        - Touch target: --touch-min: 3rem (48px)
        - Radius: --radius-sm (8px), --radius-md (12px), --radius-lg (16px), --radius-full (9999px)
        - Shadows: --shadow-sm (subtle), --shadow-md (card), --shadow-lg (elevated)
        - Borders: --border-1 (1px), --border-2 (2px emphasis)
        - Focus: --focus-ring-width (2px), --focus-ring-offset (2px)
        - On-primary: --color-on-primary (text color on --color-primary backgrounds)
        - Semantic feedback: --color-error/-success/-warning/-info (each with -fg and -bg pairing)

      COLOR ACCESSIBILITY (hard requirements):
        - Normal text: 4.5:1 contrast on its background (WCAG AA)
        - Large text (18px+ or 14px+ bold): 3:1 minimum
        - Essential UI boundaries: 3:1 minimum
        - Muted text must still meet 4.5:1 on its actual background

      REDUCED MOTION (document in design-tokens.md):
        - Non-essential animation disabled under prefers-reduced-motion
        - Opacity-only transitions acceptable as reduced alternatives

      Reference $ARTIFACTS_DIR/ux-patterns.md for how components use these tokens.
```

### inventory node

**Add to read list** (after current item 4):
```yaml
        5. $ARTIFACTS_DIR/ux-patterns.md   - code examples for this css_approach
```

**Insert** AFTER "3. [testable check]" and BEFORE "If design_tools is...":

```yaml
      Read $ARTIFACTS_DIR/ux-patterns.md for exact implementation patterns.

      COMPONENT SIZE SPECIFICATIONS (use these exact values):

      Button sizes:
        | Size | Height | Horiz padding | Font            |
        |------|--------|---------------|-----------------|
        | sm   | 32px   | 12px          | 14px / weight-600 |
        | md   | 40px   | 16px          | 16px / weight-600 |
        | lg   | 48px   | 20px          | 16px / weight-600 |
        Primary CTAs on mobile: lg (48px = touch-min).
        See button-states pattern in ux-patterns.md for full code.

      Badge: px-3 py-1, text-xs (12px), weight-500, rounded-full. Display-only.

      Skeleton: must match final layout dimensions. See skeleton-pulse in ux-patterns.md.

      Card: padding var(--space-8), radius var(--radius-lg), shadow var(--shadow-md).
        Interactive cards ONLY get hover elevation — see card-elevation in ux-patterns.md.
        Static cards: shadow-md, no hover.

      Form inputs: min-height 44px, 48px for primary mobile forms.
        See form-controls pattern in ux-patterns.md for label + input + error layout.

      INTERACTION STATES (all interactive components):
        | State         | Required change                                |
        |---------------|------------------------------------------------|
        | hover         | visible change in fill, border, or elevation   |
        | active        | pressed feel — darker fill or reduced elevation|
        | focus-visible | focus ring — see focus-ring in ux-patterns.md  |
        | disabled      | reduced emphasis, preserved legibility          |
        Native `disabled` on <button>/<input>/<select>/<textarea>.
        `aria-disabled` only on custom non-native controls.
        See disabled-native-vs-aria in ux-patterns.md.

      REDUCED MOTION: every animated component must handle prefers-reduced-motion.
        See reduced-motion pattern in ux-patterns.md.
```

### implement node

**Add to read list** (after current item 9):
```yaml
        10. $ARTIFACTS_DIR/ux-patterns.md   - UX code patterns (COPY THESE EXACTLY)
```

**Insert** AFTER "Zero hardcoded hex values..." and BEFORE "After EACH component...":

```yaml
      UX PATTERNS (from ux-patterns.md — follow these exactly):
        - Copy the button-states pattern for every Button variant
        - Copy the card-elevation pattern for interactive Cards
        - Copy the skeleton-pulse pattern for Skeleton components
        - Copy the focus-ring pattern for every interactive element
        - Copy the form-controls pattern for any input/select/textarea
        - Apply the reduced-motion pattern to every animated element
        - Use the responsive-container pattern for page layout
        - Use the touch-target pattern for icon-only buttons

      MOTION (mandatory):
        - Every hover/focus change MUST use transition with motion tokens
        - Every animation MUST include reduced-motion fallback

      RESPONSIVE (mandatory):
        - Base = mobile (375px), md: for tablet, lg: for desktop
        - No horizontal overflow at 375px

      ACCESSIBILITY (non-negotiable):
        - focus-visible: always present, never suppressed
        - Native disabled on native controls
        - All text 4.5:1 contrast on its background
```

**Replace** the current 4-item MANDATE CHECK with:

```yaml
      MANDATE CHECK before marking each component done:
        [] Touch targets >= 48px on interactive elements (min-h-12)
        [] All states present (hover, active, focus-visible, disabled)
        [] Transitions use motion tokens (--duration-fast, --ease-out)
        [] focus-visible has ring — not suppressed
        [] Zero hardcoded values — tokens or utilities only
        [] Responsive: no overflow at 375px
        [] Reduced motion handled (motion-reduce: on all animations)
        [] Native disabled on native controls
        [] TypeScript: bun run typecheck passes
```

### review node

**Add to read list** (after current item 10):
```yaml
        11. $ARTIFACTS_DIR/ux-patterns.md   - patterns that were prescribed
```

**Insert** AFTER the ACCESSIBILITY checklist section and BEFORE "Score each: PASS / FAIL / WARN...":

```yaml
      UX PATTERN VERIFICATION (check against ux-patterns.md):
        [] Every interactive element has hover + active + focus-visible + disabled?
        [] Focus ring present on all interactive elements, not suppressed?
        [] Motion tokens used consistently across components?
        [] Reduced motion handled? (motion-reduce: or @media prefers-reduced-motion)
        [] Interactive cards have shadow transition? Static cards do not?
        [] Skeleton has pulse with reduced-motion fallback?
        [] Touch targets meet 48px on primary interactive elements?
        [] Typography follows token scale?
        [] No horizontal overflow at 375px?
        [] Native disabled on native controls?
        [] Color tokens used — no ad-hoc hex values for text colors?
        [] Form inputs follow form-controls pattern if present?
```

---

## Complete Pipeline (24 nodes)

```
Phase 0 — Setup + Calibration (7 nodes)
  scaffold           bash
  read-profile       bash
  calibrate          prompt
  gate-calibrate     approval
  refine-profile     prompt
  save-profile       bash
  resolve-dictionary bash      NEW

Phase 1 — Design (2 nodes)
  brief              prompt    (unchanged)
  gate-brief         approval  (unchanged)

Phase 2 — Tokens + Inventory (3 nodes)
  tokens             prompt    MODIFIED — prescriptive scales + reads ux-patterns.md
  inventory          prompt    MODIFIED — component sizes + reads ux-patterns.md
  gate-plan          approval  (unchanged)

Phase 3 — PRD + Planning (4 nodes, unchanged)
  prd, gate-prd, plan, estimate

Phase 4 — Build (2 nodes)
  implement          prompt    MODIFIED — pattern mandates + reads ux-patterns.md
  verify             bash      (unchanged)

Phase 5 — Review + Rework (5 nodes)
  review             prompt    MODIFIED — pattern verification + reads ux-patterns.md
  gate-final, rework, verify-rework, gate-rework  (unchanged)

Phase 6 — Persist (1 node, unchanged)
  persist-handoff    bash
```

## Verification

1. YAML syntax valid
2. Node count = 24
3. `.pi/ux-dictionary.md` has 2 concrete sections: tailwind (11 patterns) and css_modules (11 patterns)
4. vanilla_css maps to css_modules + note, styled_components maps to tailwind + note
5. No hardcoded colors — all examples use token vars
6. All Tailwind examples use single `transition` utility (not multiple transition-*)
7. All focus-visible patterns include `ring-offset-[var(--color-surface)]`
8. resolve-dictionary: exit 1 on missing file, Tailwind fallback on empty extraction
9. All 4 modified nodes have `$ARTIFACTS_DIR/ux-patterns.md` in numbered read lists

## Codex Review History

This plan was reviewed by Codex GPT-5.4 through 7 rounds:
- Strategic review: architecture validated, abstract rules rejected for small models
- Dictionary re-review: dictionary approach approved with restructure
- Plan v1: 6 findings (resolve-dictionary, non-Tailwind, read lists, white, forms, z-index)
- Plan v2: 3 new (transition composition, ring offset, diff sync) + 2 prior still open
- Plan v3: 2 remaining (pattern count, vanilla/styled prose)
- Plan v4: 1 remaining (styled_components mapping)
- Plan v5: 0 findings — **APPROVED**
