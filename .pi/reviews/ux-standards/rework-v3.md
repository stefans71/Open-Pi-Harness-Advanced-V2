# UX Standards — Rework v3 (Diff Review v3: 1 finding)

## Context

Diff review v3: REVISE. All 6 v2 fixes confirmed FIXED. 1 new finding.

---

## Fix 1: menu-button — focus must return to trigger on close

The menu-button pattern closes on Escape but never restores focus to the trigger button. The dialog pattern does this correctly (triggerRef + cleanup). Menu-button needs the same treatment.

**Tailwind section** — update menu-button:

Add a ref to the trigger and restore focus on close:
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

**CSS Modules section** — same changes:
1. Add `triggerRef` ref
2. Add `close()` helper that calls `setOpen(false)` then `triggerRef.current?.focus()`
3. Add `ref={triggerRef}` to the trigger button
4. Replace `setOpen(false)` in Escape handler with `close()`

Key changes from current code:
- `const triggerRef = useRef<HTMLButtonElement>(null);`
- `const close = () => { setOpen(false); triggerRef.current?.focus(); };`
- Trigger: `ref={triggerRef}`
- Escape handler: `close()` instead of `setOpen(false)`

When done, prepare the updated diff review bundle at `.pi/reviews/ux-standards/`.
