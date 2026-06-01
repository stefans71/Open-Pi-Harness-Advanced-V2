# UX Standards — Rework v4 (Blind Eval fixes)

## Context

Blind eval scored 2.8/5. We're fixing 4 categories of issues before overriding. These are all in `.pi/ux-dictionary.md` except Fix 4 which also touches `web-design.yaml`.

---

## Fix 1: CSS Modules dialog — replace display:none with visibility:hidden

The `display: 'none'` approach removes the trigger from the accessibility tree. Use `visibility: hidden` + `position: absolute` instead — element stays in DOM, is focusable, but is invisible and out of layout flow.

In the css_modules dialog-modal pattern, change the trigger button's style prop:
```tsx
style={open ? { visibility: 'hidden', position: 'absolute' } : undefined}
```

Was:
```tsx
style={open ? { display: 'none' } : undefined}
```

---

## Fix 2: Tailwind dialog/menu/tabs — add React import lines

The 3 new Tailwind patterns use hooks but don't show the import. Add import lines for copy-paste completeness.

**dialog-modal** — add at the top before the function:
```tsx
import { useEffect, useId, useRef } from 'react';
```

**menu-button** — add at the top:
```tsx
import { useId, useRef, useState } from 'react';
```

**tabs** — add at the top:
```tsx
import { useRef, useState } from 'react';
```

---

## Fix 3: Tokenize hardcoded values

### 3a. Focus ring width/offset — ALL Tailwind patterns that use focus-visible

Replace every occurrence in the tailwind section:
- `ring-2` → `ring-[length:var(--focus-ring-width)]`
- `ring-offset-2` → `ring-offset-[length:var(--focus-ring-offset)]`

This affects: button-states, card-elevation, form-controls, touch-target, focus-ring, and any other pattern using the focus ring string.

The standalone focus-ring pattern becomes:
```
"focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[length:var(--focus-ring-offset)] focus-visible:ring-offset-[var(--color-surface)]"
```

### 3b. Dialog overlay color — BOTH sections

The dialog-modal uses a raw RGB color (`rgb(15 23 42 / 56%)`) for the backdrop/scrim. This should be a token.

**Tailwind section** — change:
```
bg-[color:rgb(15_23_42_/_0.56)]
```
to:
```
bg-[var(--color-scrim)]
```

**CSS Modules section** — change:
```css
.backdrop { ... background: rgb(15 23 42 / 56%); }
```
to:
```css
.backdrop { ... background: var(--color-scrim); }
```

**Also add `--color-scrim` to the tokens node** in `web-design.yaml`. In the ALSO DEFINE section, add:
```
- Scrim/overlay: --color-scrim (semi-transparent dark overlay for modals)
```

---

## Fix 4: Button size scale — clarify touch-target context

The button scale has sm=32px and md=40px which are below the 48px touch target. This is intentional (desktop secondary actions) but needs explicit documentation so small models don't use sm/md for mobile primary actions.

### In ux-dictionary.md — button-states pattern (BOTH sections)

After the size scale note, add:
```
Touch-target rule: lg (48px) is REQUIRED for mobile and primary actions. sm/md are for desktop secondary controls only.
```

### In web-design.yaml — inventory node

After the button sizes table, the note currently says:
```
Primary CTAs on mobile: lg (48px = touch-min).
```

Change to:
```
Primary CTAs and mobile: MUST use lg (48px = touch-min). sm/md are for desktop secondary actions only — never use below 48px for touch or primary interactions.
```

---

## Summary

| Fix | File(s) | Change |
|-----|---------|--------|
| 1 | ux-dictionary.md (css_modules dialog) | display:none → visibility:hidden + position:absolute |
| 2 | ux-dictionary.md (tailwind dialog/menu/tabs) | Add React import lines |
| 3a | ux-dictionary.md (all tailwind focus patterns) | ring-2 → ring-[length:var(--focus-ring-width)], ring-offset-2 → ring-offset-[length:var(--focus-ring-offset)] |
| 3b | ux-dictionary.md (dialog both sections) + web-design.yaml (tokens node) | RGB overlay → var(--color-scrim) |
| 4 | ux-dictionary.md (button-states both sections) + web-design.yaml (inventory node) | Add touch-target context notes |

When done, confirm all changes applied. No need to rebuild the diff review bundle — we're overriding after these fixes.
