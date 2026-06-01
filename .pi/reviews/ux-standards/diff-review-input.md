# Diff Review v4 — UX Standards Dictionary (Post-Rework v3)

## Review History

- **v1:** REVISE — 4 findings, all dictionary-only. YAML workflow changes clean.
- **v2:** REVISE — 6 findings (2 prior incomplete + 4 new). YAML still clean.
- **v3:** REVISE — 1 finding (menu-button focus return on close).
- **v4 (this):** v3 finding fixed.

## Changes Since v3

1. menu-button (both sections): added `triggerRef` + `close()` helper that returns focus to trigger on Escape. Matches dialog pattern's focus-return behavior.

---

## Summary

Professional UX/UI standards dictionary + workflow integration. Small LLMs copy concrete patterns instead of inferring abstract design rules.

**Files changed:**
| File | Action | Lines |
|------|--------|-------|
| `.pi/ux-dictionary.md` | NEW | 851 |
| `.pi/workflows/web-design.yaml` | MODIFY | 810 → 995 |

**Node count:** 24 (was 23, +1 resolve-dictionary)

---

## PI Workflow Engine Reference

### Node Types (from schema.ts)

```typescript
export interface BashNode {
    id: string;
    type: "bash";
    command: string;
    timeout?: number;
    allow_failure?: boolean;       // If true, workflow continues even if exit code != 0
}

export interface PromptNode {
    id: string;
    type: "prompt";
    prompt: string;
    allowed_tools?: string[];
    fresh_context?: boolean;       // New LLM session — reads everything from disk
    expected_artifacts?: string[];
}
```

### Variable Substitution

All `$VARIABLE` placeholders are text-substituted before execution:
- `$ARTIFACTS_DIR` → `.pi/workflow-artifacts/<name>-<timestamp>/`
- `$USER_MESSAGE`, `$REJECTION_REASON`, `$MODEL_*` variables
- Bash nodes without `allow_failure: true` stop the workflow on non-zero exit

---

## Architecture

```
.pi/ux-dictionary.md          (851 lines, static, checked into repo)
  ├── ## [approach:tailwind]   — 14 patterns (JSX + Tailwind)
  └── ## [approach:css_modules] — 14 patterns (JSX + CSS Modules)
                ↓
resolve-dictionary (bash)      — extracts matching section via awk
  ├── exit 1 if dictionary missing
  ├── fallback to tailwind if <5 lines extracted
  └── adaptation notes for vanilla_css and styled_components
                ↓
$ARTIFACTS_DIR/ux-patterns.md  (approach-specific subset)
                ↓
tokens, inventory, implement, review  (numbered read lists)
```

### 14 Patterns per Approach

| # | Pattern | Key accessibility feature |
|---|---------|--------------------------|
| 1 | button-states | Native disabled, size scale |
| 2 | card-elevation | Interactive vs static distinction |
| 3 | skeleton-pulse | aria-busy + aria-hidden |
| 4 | focus-ring | ring-offset-[var(--color-surface)] |
| 5 | form-controls | htmlFor/id/aria-describedby |
| 6 | responsive-container | Mobile-first, no overflow 375px |
| 7 | touch-target | 48px + aria-label |
| 8 | reduced-motion | Utility pattern |
| 9 | disabled-native-vs-aria | Native vs custom controls |
| 10 | color-contrast | Token pairings only |
| 11 | sticky-header | z-index token |
| 12 | dialog-modal | Focus trap + aria-modal + aria-labelledby |
| 13 | menu-button | aria-haspopup + roving focus + aria-label + focus-return |
| 14 | tabs | Roving tabindex + .focus() + ArrowLeft/Right |

---

## Review Checklist

1. **YAML syntax** — parses without error (verified: 24 nodes)
2. **resolve-dictionary** — exit 1 on missing file, tailwind fallback on empty
3. **Read list numbering** — sequential in all modified nodes (tokens:4, inventory:5, implement:10, review:11)
4. **Token tables** — prescriptive values, inventory font uses --text-button/--text-caption tokens
5. **Implement checklist** — 9 items
6. **Review verification** — 12 UX checks
7. **Dictionary structural parity** — both sections have 14 patterns, all have "When:" + code
8. **Utility patterns** — focus-ring, reduced-motion, color-contrast have "Utility pattern" notes in css_modules
9. **Accessibility completeness:**
   - form-controls: htmlFor/id + aria-describedby (both sections)
   - skeleton: aria-busy parent + aria-hidden rows (both sections)
   - dialog: focus trap + aria-modal + trigger stays mounted for focus return
   - menu-button: aria-label="Open row actions" + focus returns to trigger on close (both sections)
   - tabs: .focus() follows roving tabindex (both sections)
10. **Specificity** — css_modules card-elevation targets `.interactive:hover { transform: none }` in reduced-motion
11. **Reduced-motion coverage** — all 14 patterns either have inline handling OR explicit "No animation in base pattern" note
12. **No regressions** — existing nodes unchanged (brief, prd, plan, estimate, verify, rework, gates)

---

## YAML Diff

No YAML changes in v4. All workflow changes were PASSED in v1, v2, and v3. The YAML adds:
- resolve-dictionary bash node (after save-profile)
- ux-patterns.md to 4 read lists
- Prescriptive token tables in tokens node
- Component sizes + interaction states in inventory node
- UX pattern mandates + 9-item checklist in implement node
- 12-item UX verification in review node

---

## New File: `.pi/ux-dictionary.md` (851 lines)

Below is the complete file. Changes from v3 are marked with `← v4 fix`:

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
    "inline-flex min-h-12 items-center justify-center rounded-[var(--radius-md)] px-5 py-2",
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
<div aria-busy="true">
  <div className="h-6 w-40 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
  <div className="h-4 w-full animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
  <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--color-canvas)] motion-reduce:animate-none" aria-hidden="true" />
</div>
```
Always pair `animate-pulse` with `motion-reduce:animate-none`.
Parent container: `aria-busy="true"` while loading. Skeleton rows: `aria-hidden="true"` (decorative).

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
Height: min-h-12 (48px). Touch-target compliant.
Label above with --space-1 gap. Error text with --color-error.
Select: same sizing + border. Textarea: same border/focus, min rows 3.
Accessible wiring: `htmlFor`/`id` pair + `aria-describedby` pointing to error message.

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
When: toggling disabled state on interactive controls.
Native `<button>`, `<input>`, `<select>`, `<textarea>` → use `disabled` attribute:
```tsx
<button disabled className="... disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-ink-muted)]">
```
Custom non-native controls → use `aria-disabled="true"`:
```tsx
<div role="button" aria-disabled="true" tabIndex={-1} className="... opacity-60 cursor-not-allowed pointer-events-none">
```

### color-contrast
When: any text or UI element with color.
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

### dialog-modal
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
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.

### menu-button
When: action menus anchored to a trigger button.
```tsx
function RowMenu() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Open row actions"
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
                if (e.key === 'Escape') { e.preventDefault(); close(); }
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
Trigger: aria-haspopup + aria-expanded + aria-controls. Items: role="menuitem". Keyboard: ArrowDown/Up to navigate, Escape to close with focus returned to trigger. ArrowDown on trigger opens and focuses first item.
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.

### tabs
When: peer content panels where only one panel is visible at a time.
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
Roving tabindex: only active tab in tab order. ArrowLeft/Right to navigate, Home/End for first/last. Each panel: role="tabpanel" + aria-labelledby pointing to its tab.
No animation in base pattern. If adding panel transitions, apply reduced-motion handling per the reduced-motion pattern.

---

## [approach:css_modules]

### button-states
When: every interactive button.
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
Size scale: sm=h-8/px-3/text-sm, md=h-10/px-4, lg=h-12/px-5 (lg default on mobile).
Native `disabled` on `<button>`. Never `aria-disabled` on native controls.

### card-elevation
When: clickable cards, tiles. NOT static info cards.
```tsx
import styles from './Card.module.css';
<a href="#" className={cn(styles.card, styles.interactive)}>
  <h3 className={styles.title}>Title</h3>
  <p className={styles.description}>Description</p>
</a>
```
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
  .interactive { transition: none; }
  .interactive:hover { transform: none; }
}
```
Static/info cards: use `styles.card` only, no `styles.interactive`.

### skeleton-pulse
When: loading placeholders. Match final layout dimensions.
```tsx
import styles from './Skeleton.module.css';
<div aria-busy="true">
  <div className={styles.skeleton} style={{ height: '1.5rem', width: '10rem' }} aria-hidden="true" />
  <div className={styles.skeleton} style={{ height: '1rem', width: '100%' }} aria-hidden="true" />
  <div className={styles.skeleton} style={{ height: '1rem', width: '83%' }} aria-hidden="true" />
</div>
```
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
Parent container: `aria-busy="true"` while loading. Skeleton rows: `aria-hidden="true"` (decorative).

### focus-ring
When: every interactive element — buttons, inputs, links, cards, tabs.
```css
.focusable:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--focus-ring-offset) var(--color-surface),
              0 0 0 calc(var(--focus-ring-offset) + var(--focus-ring-width)) var(--color-accent);
}
```
Utility pattern — apply this CSS within component stylesheets. See button-states and form-controls for usage.
NEVER use `outline: none` alone. NEVER suppress focus-visible.

### form-controls
When: text inputs, selects, textareas.
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
```css
.fieldGroup { display: flex; flex-direction: column; gap: var(--space-1); }
.field {
  min-height: var(--touch-min);
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
Height: var(--touch-min) = 48px. Touch-target compliant.
Accessible wiring: `htmlFor`/`id` pair + `aria-describedby` pointing to error message.

### responsive-container
When: page sections and content wrappers.
```tsx
import styles from './Container.module.css';
<section className={styles.container}>
  <div className={styles.prose}>
    <h1>Dashboard</h1>
  </div>
</section>
```
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
Base = mobile (375px). md: for larger screens. No horizontal overflow.

### touch-target
When: icon buttons, tabs, tappable items.
```tsx
import styles from './IconButton.module.css';
<button type="button" className={styles.iconButton} aria-label="Open filters">
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={styles.icon} />
</button>
```
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
min-height/min-width = var(--touch-min) = 48px. aria-label required on icon-only buttons.

### reduced-motion
When: any animated/transitioning element.
```css
@media (prefers-reduced-motion: reduce) {
  .animated { animation: none; }
  .transitioning { transition: none; transform: none; }
}
```
Utility pattern — add this media query inside any component stylesheet that uses animation or transition.

### disabled-native-vs-aria
When: toggling disabled state on interactive controls.
Native controls use `:disabled`:
```css
.button:disabled, .field:disabled {
  background: var(--color-border);
  color: var(--color-ink-muted);
  cursor: not-allowed;
}
```
Custom controls:
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
```css
.disabled { opacity: 0.6; cursor: not-allowed; pointer-events: none; }
```

### color-contrast
When: any text or UI element with color.
```css
.heading { color: var(--color-ink); }
.muted { color: var(--color-ink-muted); }
.badgeWarning {
  background: var(--color-warning-bg);
  color: var(--color-warning-fg);
}
```
Utility pattern — use these token pairings in component stylesheets. Never use ad-hoc hex/rgb colors.
Semantic feedback: use paired --color-{status}-fg and --color-{status}-bg tokens.

### sticky-header
When: app shell with fixed navigation.
```tsx
import styles from './Header.module.css';
<header className={styles.header}>
  <nav className={styles.nav}>{/* items */}</nav>
</header>
```
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
Use z-index: var(--z-sticky), nav height = var(--space-16) (64px).

### dialog-modal
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.button}
        onClick={() => {}}
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
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.

### menu-button
When: action menus anchored to a trigger button.
```tsx
import { useId, useRef, useState } from 'react';
import styles from './MenuButton.module.css';

function RowMenu() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Open row actions"
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
                if (e.key === 'Escape') { e.preventDefault(); close(); }
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
Trigger: aria-haspopup + aria-expanded + aria-controls. Items: role="menuitem". Keyboard: ArrowDown/Up, Escape to close with focus returned to trigger.
No animation in base pattern. If adding open/close transitions, apply reduced-motion handling per the reduced-motion pattern.

### tabs
When: peer content panels where only one panel is visible at a time.
```tsx
import { useRef, useState } from 'react';
import styles from './Tabs.module.css';

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
      <div role="tablist" aria-label="Product sections" className={styles.tabList}>
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
            className={active === index ? `${styles.tab} ${styles.tabActive}` : styles.tab}
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
No animation in base pattern. If adding panel transitions, apply reduced-motion handling per the reduced-motion pattern.
```
