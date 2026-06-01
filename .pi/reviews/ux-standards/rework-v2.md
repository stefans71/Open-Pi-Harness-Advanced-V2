# UX Standards — Rework v2 (Diff Review v2 findings)

## Context

Diff review v2: REVISE. YAML workflow still clean. 2 prior fixes incomplete + 4 new findings in dictionary patterns. 6 fixes total.

v1 fixes confirmed FIXED: 2 (card-elevation specificity), 4 (3 new patterns added), 5 (accessible wiring), 6 (button radius), 7 (skeleton aria), 8 (inventory font tokens). Do NOT touch these.

---

## Fix 1: Inventory form input text — leftover 44px reference

In `web-design.yaml`, the inventory node still says:
```
Form inputs: min-height 44px, 48px for primary mobile forms.
```

Change to:
```
Form inputs: min-height 48px (var(--touch-min)). Touch-target compliant.
```

This matches the dictionary fix already applied (min-h-12 / var(--touch-min)).

---

## Fix 2: css_modules utility patterns — clarify structure

Three css_modules patterns are CSS-only utility/rule patterns that don't have standalone JSX: `focus-ring`, `reduced-motion`, `color-contrast`.

These don't need full JSX examples (they're applied within other component patterns, not rendered standalone). But they need "When:" descriptions to match the tailwind section's structure.

For each of these 3, add the "When:" line from the tailwind section if not already present, and add a one-line note:

**focus-ring:**
```
When: every interactive element — buttons, inputs, links, cards, tabs.
```
Add note: "Utility pattern — apply this CSS within component stylesheets. See button-states and form-controls for usage."
Add note: "NEVER use `outline: none` alone. NEVER suppress focus-visible."

**reduced-motion:**
```
When: any animated/transitioning element.
```
Add note: "Utility pattern — add this media query inside any component stylesheet that uses animation or transition."

**color-contrast:**
```
When: any text or UI element with color.
```
Add note: "Utility pattern — use these token pairings in component stylesheets. Never use ad-hoc hex/rgb colors."

---

## Fix 3: menu-button trigger — missing aria-label

The menu-button trigger is an icon-only button but has no `aria-label`. This contradicts the dictionary's own touch-target rule.

**Tailwind section:** Add `aria-label="Open row actions"` to the trigger button:
```tsx
<button
  type="button"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={menuId}
  aria-label="Open row actions"
  className={cn("inline-flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-md)]")}
  ...
```

**CSS Modules section:** Same — add `aria-label="Open row actions"` to the trigger button.

---

## Fix 4: tabs — keyboard nav must call .focus()

The tabs pattern updates `active` state on arrow keys but never moves DOM focus to the newly active tab. Roving tabindex requires focus to follow.

**Both sections:** Add refs and focus calls. Here's the updated pattern:

**Tailwind:**
```tsx
function ProductTabs() {
  const tabs = ['Overview', 'Specs', 'Reviews'];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activate = (index: number) => {
    setActive(index);
    tabRefs.current[index]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Product sections" className="flex gap-[var(--space-2)] border-b border-[var(--color-border)]">
        {tabs.map((label, index) => (
          <button
            key={label}
            ref={(node) => { tabRefs.current[index] = node; }}
            id={`tab-${index}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={`panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            className={cn(
              "inline-flex min-h-12 items-center border-b-2 px-[var(--space-4)] text-[length:var(--text-button)]",
              active === index ? "border-[var(--color-accent)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)]"
            )}
            onClick={() => activate(index)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') activate((index + 1) % tabs.length);
              if (e.key === 'ArrowLeft') activate((index + tabs.length - 1) % tabs.length);
              if (e.key === 'Home') activate(0);
              if (e.key === 'End') activate(tabs.length - 1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map((label, index) => (
        <section key={label} id={`panel-${index}`} role="tabpanel" aria-labelledby={`tab-${index}`} hidden={active !== index} className="pt-[var(--space-6)]">
          Panel: {label}
        </section>
      ))}
    </div>
  );
}
```

**CSS Modules:** Same logic — add `tabRefs`, `activate` helper, `ref` callback on each tab button, replace `setActive` calls with `activate` calls in `onClick` and `onKeyDown`.

---

## Fix 5: CSS Modules dialog — keep trigger mounted

The CSS Modules dialog conditionally renders either the trigger OR the dialog. When the dialog opens, the trigger unmounts, so `triggerRef.current` is cleared and focus can't return to it on close.

Fix: keep the trigger always mounted (hidden when dialog is open), matching the Tailwind version's structure:

```tsx
return (
  <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.button}
      onClick={() => onOpen?.()}
      style={open ? { display: 'none' } : undefined}
    >
      Open settings
    </button>
    {open && (
      <div className={styles.scrim}>
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className={styles.dialog}>
          <h2 id={titleId} className={styles.title}>Settings</h2>
          <p id={descId} className={styles.description}>Changes apply immediately.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.button}>Save</button>
            <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )}
  </>
);
```

This keeps triggerRef alive so the cleanup effect can reliably return focus.

---

## Fix 6: New patterns — reduced-motion clarification

The 3 new patterns (dialog-modal, menu-button, tabs) don't include reduced-motion handling. The dictionary rule says "every pattern" must have it, but these patterns contain no animation or transition in their examples.

Add a one-line note at the bottom of each of these 6 pattern blocks (3 tailwind + 3 css_modules):

For dialog-modal:
```
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.
```

For menu-button:
```
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.
```

For tabs:
```
No animation in base pattern. If adding panel transitions, apply reduced-motion handling per the reduced-motion pattern.
```

---

## Summary

| Fix | File | Scope |
|-----|------|-------|
| 1 | web-design.yaml (inventory node) | Change "44px" to "48px (var(--touch-min))" |
| 2 | ux-dictionary.md (3 css_modules patterns) | Add "When:" + utility pattern notes |
| 3 | ux-dictionary.md (menu-button, both sections) | Add aria-label to trigger |
| 4 | ux-dictionary.md (tabs, both sections) | Add refs + .focus() on keyboard nav |
| 5 | ux-dictionary.md (dialog css_modules) | Keep trigger mounted |
| 6 | ux-dictionary.md (3 new patterns, both sections) | Add reduced-motion notes |

When done, prepare the updated diff review bundle at `.pi/reviews/ux-standards/`.
