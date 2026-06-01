## Section 1: Diff Review Findings

1. `.pi/ux-dictionary.md:form-controls` — **The new dictionary still ships an unresolved size/accessibility conflict for form controls.**
   Tailwind `form-controls` uses `min-h-11` and explicitly documents `44px` as the default height, while the workflow’s implementation mandate says interactive elements should meet the `48px` target. The diff therefore adds a dictionary that is not internally consistent with the workflow guidance it is supposed to drive.
   Fix: Pick one standard and make it consistent across the workflow and dictionary. If the intended rule is `48px` for interactive controls, change Tailwind to `min-h-12` and CSS Modules to `min-height: var(--touch-min)`, then update the inventory text to match.

2. `.pi/ux-dictionary.md:css_modules` — **The CSS Modules half is not copy-paste-ready for small models.**
   Most CSS Modules patterns are CSS-only and omit the Tailwind section’s `When:` guidance plus JSX usage. That leaves the model without the element type, ARIA wiring, or class composition pattern the feature is supposed to provide.
   Fix: For every CSS Modules pattern, add `When:`, a JSX usage snippet with `import styles`, and the matching `.module.css` block.

3. `.pi/ux-dictionary.md:card-elevation` — **The CSS Modules reduced-motion override does not actually neutralize the hover transform.**
   `.interactive:hover` is more specific than `.interactive` inside the reduced-motion media query, so the hover lift can survive under `prefers-reduced-motion: reduce`.
   Fix: In the reduced-motion media query, override the hover selector directly: `.interactive:hover { transform: none; }`.

4. `.pi/ux-dictionary.md:patterns` — **The dictionary is missing `dialog-modal`, `menu-button`, and `tabs`, so the shipped pattern set is incomplete.**
   The brief calls these out as common, accessibility-sensitive app patterns. The current file still has 11 patterns per section and does not cover them.
   Fix: Add those 3 patterns to both `tailwind` and `css_modules`, bringing each section to 14 patterns.

Verdict: REVISE

Notes: YAML structure, node count, `resolve-dictionary` placement, missing-file failure behavior, empty-extraction fallback, read-list numbering, prescriptive token tables, 9-item implement checklist, 12-item review verification block, and `$ARTIFACTS_DIR` substitution usage all check out from the diff shown in `codex-brief.md`.

## Section 2: Dictionary Audit

Finding 1: FALSE POSITIVE
  The current brief itself still allows `44px` default form inputs and `48px` only for primary mobile forms, so the dictionary is matching that written spec. This is still an internal standards conflict, but not a clean dictionary-only bug.

Finding 2: CONFIRMED
  The CSS Modules `card-elevation` pattern uses `.interactive:hover { transform: translateY(-2px); }` and only resets `.interactive` inside reduced motion.

Finding 3: CONFIRMED
  Most CSS Modules patterns are CSS-only and omit both `When:` guidance and JSX usage examples.

Finding 4: CONFIRMED
  The CSS Modules `form-controls` pattern has `.label`, `.field`, and `.error` CSS but no JSX showing `htmlFor`, `id`, or `aria-describedby`.

Finding 5: CONFIRMED
  The CSS Modules `touch-target` pattern shows only `.iconButton` CSS and no JSX with `type="button"`, `aria-label`, or `aria-hidden` on the icon.

Finding 6: CONFIRMED
  The CSS Modules `disabled-native-vs-aria` example reduces the custom-control case to a `.disabled` class and does not show `role="button"`, `aria-disabled="true"`, or `tabIndex={-1}`.

Finding 7: CONFIRMED
  Tailwind `button-states` hardcodes `rounded-xl` while CSS Modules uses `var(--radius-md)`. The current default visual result happens to align, but token parity is still broken.

Finding 8: CONFIRMED
  Tailwind focus rings hardcode `ring-2` and `ring-offset-2`, while CSS Modules uses `--focus-ring-width` and `--focus-ring-offset`. Severity is low because both currently resolve to `2px`, but the parity issue is real.

Finding 9: CONFIRMED
  The skeleton examples do not mark the placeholder rows as decorative and do not note that the loading region should expose `aria-busy="true"`.

Finding 10: CONFIRMED
  `dialog-modal`, `menu-button`, and `tabs` are absent from both sections.

New finding A
  Tailwind `form-controls` also lacks accessible wiring. The sample label has no `htmlFor`, the input has no `id` or `aria-describedby`, and the error message has no `id`.

New finding B
  The button typography guidance is inconsistent across the materials. `tokens` defines `--text-button` as `15px`, both button patterns use that token, but the `inventory` table requires `16px` for `md` and `lg` buttons. A model copying the dictionary exactly will violate the inventory spec.

### New patterns: Tailwind

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
      <button ref={triggerRef} type="button" className="inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]" onClick={() => {}}>Open settings</button>
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
              <button type="button" className="inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]">Save</button>
              <button type="button" className="inline-flex min-h-12 rounded-[var(--radius-md)] px-[var(--space-5)]" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

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
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-[var(--radius-md)]"
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
            className="inline-flex min-h-12 items-center border-b-2 border-transparent px-[var(--space-4)] text-[length:var(--text-button)]"
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

### New patterns: CSS Modules

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
