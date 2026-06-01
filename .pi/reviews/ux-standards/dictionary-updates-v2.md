# UX Dictionary Updates v2 — Pending Fixes

These 10 findings were identified in a prior Codex review of `.pi/ux-dictionary.md` and have NOT yet been applied. The executor must apply all of these after the current diff is reviewed.

The reviewer should verify that these issues exist in the current dictionary content AND confirm they are real problems.

---

## Finding 1: form-controls default height is 44px, misses 48px touch target
**Section:** Both tailwind and css_modules
**Issue:** Tailwind uses `min-h-11` (44px), CSS Modules uses `min-height: 2.75rem` (44px). Touch-target pattern requires 48px minimum.
**Fix:** Tailwind: change `min-h-11` to `min-h-12`. CSS Modules: change `min-height: 2.75rem` to `min-height: var(--touch-min)`.

## Finding 2: css_modules card-elevation reduced-motion specificity bug
**Section:** css_modules
**Issue:** `.interactive:hover { transform: translateY(-2px) }` has higher specificity than `.interactive { transform: none }` inside the reduced-motion media query. The hover transform survives reduced-motion.
**Fix:** Override the hover state inside the media query:
```css
@media (prefers-reduced-motion: reduce) {
  .interactive { transition: none; }
  .interactive:hover { transform: none; }
}
```

## Finding 3: css_modules patterns missing JSX usage examples
**Section:** css_modules (all patterns)
**Issue:** Tailwind section includes full JSX + "When:" guidance. Many CSS Modules patterns are CSS-only with no JSX, so a 4B model doesn't know which element to use, what ARIA to apply, or how to compose classes.
**Fix:** Every CSS Modules pattern must include: (a) "When:" description, (b) JSX usage snippet with import + className, (c) CSS module code.

## Finding 4: css_modules form-controls missing accessible wiring
**Section:** css_modules
**Issue:** CSS shows `.label`, `.field`, `.error` classes but no JSX showing `htmlFor`, `id`, or `aria-describedby` to connect label→input→error.
**Fix:** Add full JSX example:
```tsx
<div className={styles.fieldGroup}>
  <label htmlFor="email" className={styles.label}>Email address</label>
  <input
    id="email"
    type="email"
    className={styles.field}
    aria-invalid="true"
    aria-describedby="email-error"
    placeholder="you@example.com"
  />
  <p id="email-error" className={styles.error}>Please enter a valid email address.</p>
</div>
```

## Finding 5: css_modules touch-target missing JSX with aria-label
**Section:** css_modules
**Issue:** Only shows `.iconButton` CSS. No JSX showing `type="button"`, `aria-label`, or `aria-hidden` on the SVG.
**Fix:** Add JSX:
```tsx
<button type="button" className={styles.iconButton} aria-label="Open filters">
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" />
</button>
```

## Finding 6: css_modules disabled-native-vs-aria missing ARIA markup
**Section:** css_modules
**Issue:** Custom control example is just `.disabled` CSS class. Missing `role="button"`, `aria-disabled="true"`, `tabIndex={-1}`.
**Fix:** Add JSX:
```tsx
<div
  role="button"
  aria-disabled="true"
  tabIndex={-1}
  className={cn(styles.customButton, styles.disabled)}
/>
```

## Finding 7: button-states cross-section token parity — radius mismatch
**Section:** Both
**Issue:** Tailwind uses `rounded-xl` (hardcoded), CSS Modules uses `var(--radius-md)`. Different visual result.
**Fix:** Tailwind should use `rounded-[var(--radius-md)]` to match CSS Modules.

## Finding 8: focus-ring sizing hardcoded in Tailwind vs tokenized in CSS Modules
**Section:** Tailwind
**Issue:** `ring-2` and `ring-offset-2` are hardcoded (2px each). CSS Modules uses `--focus-ring-width` and `--focus-ring-offset` tokens. Visual parity breaks if tokens change.
**Triage:** BORDERLINE — Tailwind's `ring-[var()]` support is limited. But the parity concern is valid. Consider using `ring-[length:var(--focus-ring-width)]` if supported, or document that both default to 2px and must be kept in sync.

## Finding 9: skeleton-pulse missing screen-reader guidance
**Section:** Tailwind (also applies to css_modules)
**Issue:** Skeleton rows are decorative but no `aria-hidden="true"`. Parent container should expose `aria-busy="true"` during loading.
**Fix:** Add `aria-hidden="true"` to skeleton rows and note that the parent container needs `aria-busy="true"`.

## Finding 10: Missing patterns — dialog-modal, menu-button, tabs
**Section:** Both
**Issue:** These are common web-app patterns with significant accessibility gotchas (focus trapping, keyboard navigation, ARIA roles). Small models will get these wrong without canonical examples.
**Fix:** Add 3 new patterns to each section (14 patterns per section total):
- `dialog-modal` — focus trap, aria-modal, escape to close, return focus on dismiss
- `menu-button` — aria-haspopup, aria-expanded, keyboard nav (arrow keys), click-outside
- `tabs` — role=tablist/tab/tabpanel, aria-selected, roving tabindex, keyboard nav
