# UX Standards — Rework Prompt (Diff Review v1 + Dictionary Updates v2)

## Part 1: Diff Review Findings

Codex reviewed your implementation. **The YAML workflow changes are clean** — node count, resolve-dictionary placement, variable substitution, read-list numbering, token tables, implement checklist (9 items), review verification (12 items), and existing node logic all pass.

**4 findings — all in `.pi/ux-dictionary.md`** (see Part 2 for the full dictionary rework).

No changes needed to `web-design.yaml`.

---

## Part 2: Dictionary Updates v2

Update `.pi/ux-dictionary.md` with ALL of the following changes. The file should go from 11 patterns per section to 14 patterns per section when done.

### Fix 1: form-controls — change default height to 48px
**Both sections.**
- Tailwind: change `min-h-11` to `min-h-12`
- CSS Modules: change `min-height: 2.75rem` to `min-height: var(--touch-min)`
- Update the note below the Tailwind example: remove "min-h-11 (44px) default," — just say "Height: min-h-12 (48px). Touch-target compliant."

### Fix 2: css_modules card-elevation — reduced-motion specificity bug
`.interactive:hover { transform: translateY(-2px) }` has higher specificity than `.interactive { transform: none }` inside the reduced-motion media query. The hover transform survives.

Replace the current reduced-motion block:
```css
@media (prefers-reduced-motion: reduce) {
  .interactive { transition: none; transform: none; }
}
```
With:
```css
@media (prefers-reduced-motion: reduce) {
  .interactive { transition: none; }
  .interactive:hover { transform: none; }
}
```

### Fix 3: css_modules — add JSX + "When:" to ALL patterns
Every CSS Modules pattern must match the Tailwind section's structure:
1. `### pattern-name`
2. `When:` description (copy from the tailwind section)
3. JSX usage snippet with `import styles from './X.module.css'`
4. CSS module code

Apply to ALL 11 existing css_modules patterns. Here are the specific JSX additions needed:

**card-elevation** — add:
```
When: clickable cards, tiles. NOT static info cards.
```
Plus JSX:
```tsx
import styles from './Card.module.css';
<a href="#" className={cn(styles.card, styles.interactive)}>
  <h3 className={styles.title}>Title</h3>
  <p className={styles.description}>Description</p>
</a>
```
Add note: "Static/info cards: use `styles.card` only, no `styles.interactive`."

**skeleton-pulse** — add:
```
When: loading placeholders. Match final layout dimensions.
```
Plus JSX:
```tsx
import styles from './Skeleton.module.css';
<div aria-busy="true">
  <div className={styles.skeleton} style={{ height: '1.5rem', width: '10rem' }} aria-hidden="true" />
  <div className={styles.skeleton} style={{ height: '1rem', width: '100%' }} aria-hidden="true" />
  <div className={styles.skeleton} style={{ height: '1rem', width: '83%' }} aria-hidden="true" />
</div>
```

**focus-ring** — add:
```
When: every interactive element — buttons, inputs, links, cards, tabs.
```
Note: "NEVER use `outline: none` alone. NEVER suppress focus-visible."

**form-controls** — add:
```
When: text inputs, selects, textareas.
```
Plus JSX (with accessible wiring):
```tsx
import styles from './Form.module.css';
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

**responsive-container** — add:
```
When: page sections and content wrappers.
```
Plus JSX:
```tsx
import styles from './Container.module.css';
<section className={styles.container}>
  <div className={styles.prose}>
    <h1>Dashboard</h1>
  </div>
</section>
```

**touch-target** — add:
```
When: icon buttons, tabs, tappable items.
```
Plus JSX:
```tsx
import styles from './IconButton.module.css';
<button type="button" className={styles.iconButton} aria-label="Open filters">
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={styles.icon} />
</button>
```
Add note: "min-height/min-width = var(--touch-min) = 48px. aria-label required on icon-only buttons."

**reduced-motion** — add:
```
When: any animated/transitioning element.
```
Note: "Add to every element using animation, transition, or hover transform."

**disabled-native-vs-aria** — add:
```
When: toggling disabled state on interactive controls.
```
Plus JSX for custom controls:
```tsx
<div
  role="button"
  aria-disabled="true"
  tabIndex={-1}
  className={cn(styles.customButton, styles.disabled)}
>
  Disabled action
</div>
```

**color-contrast** — add:
```
When: any text or UI element with color.
```

**sticky-header** — add:
```
When: app shell with fixed navigation.
```
Plus JSX:
```tsx
import styles from './Header.module.css';
<header className={styles.header}>
  <nav className={styles.nav}>{/* items */}</nav>
</header>
```

### Fix 4: Tailwind button-states — token parity for border-radius
Change `rounded-xl` to `rounded-[var(--radius-md)]` in the Tailwind button-states pattern to match CSS Modules.

### Fix 5: Tailwind form-controls — add accessible wiring
The Tailwind form-controls JSX also lacks `htmlFor`, `id`, and `aria-describedby`. Update:
```tsx
<div className="space-y-[var(--space-1)]">
  <label htmlFor="email" className="text-[length:var(--text-caption)] font-medium text-[var(--color-ink)]">
    Email address
  </label>
  <input
    id="email"
    type="email"
    className={cn(
      "min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]",
      "bg-[var(--color-canvas)] px-[var(--space-3)] text-[length:var(--text-body)] text-[var(--color-ink)]",
      "shadow-sm transition duration-[var(--duration-fast)] ease-[var(--ease-out)]",
      "placeholder:text-[var(--color-ink-muted)]",
      "hover:border-[var(--color-ink-muted)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
      "disabled:cursor-not-allowed disabled:bg-[var(--color-surface)] disabled:text-[var(--color-ink-muted)]",
      "aria-[invalid=true]:border-[var(--color-error)]",
      "motion-reduce:transition-none"
    )}
    aria-invalid="true"
    aria-describedby="email-error"
    placeholder="you@example.com"
  />
  <p id="email-error" className="text-[length:var(--text-caption)] text-[var(--color-error)]">
    Please enter a valid email address.
  </p>
</div>
```

### Fix 6: skeleton-pulse — add screen-reader guidance (both sections)
**Tailwind:** Update the JSX:
```tsx
<div aria-busy="true">
  <div className="h-6 w-40 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
  <div className="h-4 w-full animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
  <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
</div>
```
Add note: "Parent container: `aria-busy=\"true\"` while loading. Skeleton rows: `aria-hidden=\"true\"` (decorative)."

**CSS Modules:** already covered by Fix 3's skeleton JSX above (includes `aria-busy` and `aria-hidden`).

### Fix 7: button typography — resolve --text-button vs inventory conflict
Codex found that `--text-button` is defined as 15px in the tokens table, but the inventory table says md/lg buttons use 16px. 

Resolution: Update the inventory COMPONENT SIZE SPECIFICATIONS in `web-design.yaml` to use `--text-button` (15px) for all button sizes instead of hardcoded 16px. The token system is the source of truth. Change the inventory table:
```
| Size | Height | Horiz padding | Font              |
|------|--------|---------------|-------------------|
| sm   | 32px   | 12px          | --text-caption    |
| md   | 40px   | 16px          | --text-button     |
| lg   | 48px   | 20px          | --text-button     |
```

### Fix 8: Add 3 new patterns — dialog-modal, menu-button, tabs (BOTH sections)

Add these 3 new patterns to BOTH the tailwind and css_modules sections. Each section goes from 11 → 14 patterns.

**Tailwind section — add after sticky-header:**

#### dialog-modal
When: blocking dialogs that must trap focus until dismissed.
```tsx
function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusables = () =>
      root ? Array.from(root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')) : [];
    focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); (previous ?? triggerRef.current)?.focus(); };
  }, [open, onClose]);

  return (
    <>
      <button ref={triggerRef} type="button" className={cn("inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]")} onClick={() => {}}>Open settings</button>
      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-[color:rgb(15_23_42_/_0.56)] p-[var(--space-4)]">
          <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="relative w-full max-w-[32rem] rounded-[var(--radius-lg)] bg-[var(--color-canvas)] p-[var(--space-8)] shadow-[var(--shadow-lg)] focus-visible:outline-none"
          >
            <h2 id={titleId} className="text-[length:var(--text-h3)] font-semibold text-[var(--color-ink)]">Settings</h2>
            <p id={descId} className="mt-[var(--space-2)] text-[length:var(--text-body)] text-[var(--color-ink-muted)]">Changes apply immediately.</p>
            <div className="mt-[var(--space-6)] flex gap-[var(--space-3)]">
              <button type="button" className={cn("inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]")}>Save</button>
              <button type="button" className={cn("inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]")} onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```
Focus trap: Escape closes, Tab wraps, focus returns to trigger on dismiss. aria-modal + aria-labelledby + aria-describedby required.

#### menu-button
When: action menus anchored to a trigger button.
```tsx
function RowMenu() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn("inline-flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-md)]")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); requestAnimationFrame(() => focusItem(0)); } }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" />
      </button>
      {open && (
        <div id={menuId} role="menu" className="absolute right-0 top-full z-[var(--z-popover)] mt-[var(--space-2)] min-w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-2)] shadow-[var(--shadow-lg)]">
          {['Edit', 'Duplicate', 'Archive'].map((label, index) => (
            <button
              key={label}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              className="flex min-h-12 w-full items-center rounded-[var(--radius-sm)] px-[var(--space-3)] text-left"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); focusItem((index + 1) % 3); }
                if (e.key === 'ArrowUp') { e.preventDefault(); focusItem((index + 2) % 3); }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```
Trigger: aria-haspopup + aria-expanded + aria-controls. Items: role="menuitem". Keyboard: ArrowDown/Up to navigate, Escape to close. ArrowDown on trigger opens and focuses first item.

#### tabs
When: peer content panels where only one panel is visible at a time.
```tsx
function ProductTabs() {
  const tabs = ['Overview', 'Specs', 'Reviews'];
  const [active, setActive] = useState(0);

  return (
    <div>
      <div role="tablist" aria-label="Product sections" className="flex gap-[var(--space-2)] border-b border-[var(--color-border)]">
        {tabs.map((label, index) => (
          <button
            key={label}
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
            onClick={() => setActive(index)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setActive((index + 1) % tabs.length);
              if (e.key === 'ArrowLeft') setActive((index + tabs.length - 1) % tabs.length);
              if (e.key === 'Home') setActive(0);
              if (e.key === 'End') setActive(tabs.length - 1);
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
Roving tabindex: only active tab in tab order. ArrowLeft/Right to navigate, Home/End for first/last. Each panel: role="tabpanel" + aria-labelledby pointing to its tab.

---

**CSS Modules section — add after sticky-header:**

#### dialog-modal
When: blocking dialogs that must trap focus until dismissed.
```tsx
import { useEffect, useId, useRef } from 'react';
import styles from './Dialog.module.css';

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const items = root ? Array.from(root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')) : [];
    items[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && items.length) {
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); (previous ?? triggerRef.current)?.focus(); };
  }, [open, onClose]);

  return open ? (
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
  ) : (
    <button ref={triggerRef} type="button" className={styles.button}>Open settings</button>
  );
}
```
```css
.scrim { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: var(--space-4); }
.backdrop { position: absolute; inset: 0; background: rgb(15 23 42 / 56%); }
.dialog { position: relative; width: 100%; max-width: 32rem; border-radius: var(--radius-lg); background: var(--color-canvas); padding: var(--space-8); box-shadow: var(--shadow-lg); }
.title { font-size: var(--text-h3); font-weight: 600; color: var(--color-ink); }
.description { margin-top: var(--space-2); font-size: var(--text-body); color: var(--color-ink-muted); }
.actions { display: flex; gap: var(--space-3); margin-top: var(--space-6); }
.button { min-height: var(--touch-min); padding: 0 var(--space-5); border-radius: var(--radius-md); }
```
Focus trap: Escape closes, Tab wraps, focus returns to trigger on dismiss. aria-modal + aria-labelledby + aria-describedby required.

#### menu-button
When: action menus anchored to a trigger button.
```tsx
import { useId, useRef, useState } from 'react';
import styles from './MenuButton.module.css';

function RowMenu() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();

  return (
    <div className={styles.root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); requestAnimationFrame(() => focusItem(0)); } }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className={styles.icon} />
      </button>
      {open && (
        <div id={menuId} role="menu" className={styles.menu}>
          {['Edit', 'Duplicate', 'Archive'].map((label, index) => (
            <button
              key={label}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              className={styles.item}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); focusItem((index + 1) % 3); }
                if (e.key === 'ArrowUp') { e.preventDefault(); focusItem((index + 2) % 3); }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```
```css
.root { position: relative; display: inline-block; }
.trigger { min-width: var(--touch-min); min-height: var(--touch-min); border-radius: var(--radius-md); }
.icon { width: 1.25rem; height: 1.25rem; }
.menu { position: absolute; right: 0; top: calc(100% + var(--space-2)); z-index: var(--z-popover); min-width: 11rem; border: var(--border-1) solid var(--color-border); border-radius: var(--radius-md); background: var(--color-canvas); padding: var(--space-2); box-shadow: var(--shadow-lg); }
.item { display: flex; width: 100%; min-height: var(--touch-min); align-items: center; border-radius: var(--radius-sm); padding: 0 var(--space-3); text-align: left; }
```
Trigger: aria-haspopup + aria-expanded + aria-controls. Items: role="menuitem". Keyboard: ArrowDown/Up, Escape to close.

#### tabs
When: peer content panels where only one panel is visible at a time.
```tsx
import { useState } from 'react';
import styles from './Tabs.module.css';

function ProductTabs() {
  const tabs = ['Overview', 'Specs', 'Reviews'];
  const [active, setActive] = useState(0);

  return (
    <div>
      <div role="tablist" aria-label="Product sections" className={styles.tabList}>
        {tabs.map((label, index) => (
          <button
            key={label}
            id={`tab-${index}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={`panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            className={active === index ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setActive(index)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setActive((index + 1) % tabs.length);
              if (e.key === 'ArrowLeft') setActive((index + tabs.length - 1) % tabs.length);
              if (e.key === 'Home') setActive(0);
              if (e.key === 'End') setActive(tabs.length - 1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map((label, index) => (
        <section key={label} id={`panel-${index}`} role="tabpanel" aria-labelledby={`tab-${index}`} hidden={active !== index} className={styles.panel}>
          Panel: {label}
        </section>
      ))}
    </div>
  );
}
```
```css
.tabList { display: flex; gap: var(--space-2); border-bottom: var(--border-1) solid var(--color-border); }
.tab { min-height: var(--touch-min); border-bottom: var(--border-2) solid transparent; padding: 0 var(--space-4); font-size: var(--text-button); }
.tabActive { border-bottom-color: var(--color-accent); color: var(--color-ink); }
.panel { padding-top: var(--space-6); color: var(--color-ink); }
```
Roving tabindex: only active tab in tab order. ArrowLeft/Right, Home/End for navigation.

---

## Summary of ALL changes

### `.pi/ux-dictionary.md` (main rework):
1. Fix form-controls height: min-h-11 → min-h-12 (Tailwind), 2.75rem → var(--touch-min) (CSS Modules)
2. Fix card-elevation reduced-motion specificity (CSS Modules)
3. Add "When:" + JSX to ALL css_modules patterns
4. Add accessible wiring (htmlFor/id/aria-describedby) to form-controls in BOTH sections
5. Fix button-states: rounded-xl → rounded-[var(--radius-md)] (Tailwind)
6. Add aria-hidden + aria-busy to skeleton-pulse in BOTH sections
7. Add 3 new patterns (dialog-modal, menu-button, tabs) to BOTH sections → 14 patterns each

### `.pi/workflows/web-design.yaml` (minor):
8. Fix inventory button font table: hardcoded 16px → --text-button for md/lg sizes

### Update counts:
- ux-dictionary.md: 11 → 14 patterns per section
- web-design.yaml description: update "24 nodes" (unchanged) but pattern count references if any
- Review checklist in diff-review-input.md: update "11 patterns" → "14 patterns" references

When done, prepare the updated diff review bundle at `.pi/reviews/ux-standards/`.
