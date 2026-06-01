### Fix Verification
Fix 1: NOT FIXED
  The dictionary patterns were corrected to `min-h-12` / `var(--touch-min)`, but the inventory prompt still says `Form inputs: min-height 44px, 48px for primary mobile forms.` That keeps the old default alive in downstream implementation guidance ([codex-brief.md](/tmp/codex-brief.md:482)).

Fix 2: FIXED
  The CSS Modules reduced-motion override now targets `.interactive:hover { transform: none; }`, which resolves the earlier specificity gap ([codex-brief.md](/tmp/codex-brief.md:996)).

Fix 3: NOT FIXED
  `css_modules` still does not have JSX + CSS for all 14 patterns. `focus-ring`, `reduced-motion`, and `color-contrast` are CSS-only examples, so the claimed structural parity was not achieved ([codex-brief.md](/tmp/codex-brief.md:1038), [codex-brief.md](/tmp/codex-brief.md:1156), [codex-brief.md](/tmp/codex-brief.md:1191)).

Fix 4: FIXED
  `dialog-modal`, `menu-button`, and `tabs` were added, bringing both sections to 14 patterns ([codex-brief.md](/tmp/codex-brief.md:776), [codex-brief.md](/tmp/codex-brief.md:836), [codex-brief.md](/tmp/codex-brief.md:884), [codex-brief.md](/tmp/codex-brief.md:1229), [codex-brief.md](/tmp/codex-brief.md:1288), [codex-brief.md](/tmp/codex-brief.md:1346)).

Fix 5: FIXED
  Both `form-controls` sections now include `htmlFor`/`id` and `aria-describedby` wiring ([codex-brief.md](/tmp/codex-brief.md:674), [codex-brief.md](/tmp/codex-brief.md:1054)).

Fix 6: FIXED
  Tailwind button radius uses `rounded-[var(--radius-md)]` instead of `rounded-xl` ([codex-brief.md](/tmp/codex-brief.md:604)).

Fix 7: FIXED
  Both skeleton patterns now use `aria-busy` on the container and `aria-hidden` on decorative rows ([codex-brief.md](/tmp/codex-brief.md:640), [codex-brief.md](/tmp/codex-brief.md:1022)).

Fix 8: FIXED
  The inventory button size table now uses `--text-button` / `--text-caption` tokens instead of a hardcoded `16px` font ([codex-brief.md](/tmp/codex-brief.md:465)).

### New Findings
1. `/tmp/codex-brief.md:809` — **The new menu-button pattern uses an icon-only trigger without an accessible name**
   Both Tailwind and CSS Modules show an icon-only trigger button with no visible text and no `aria-label`, even though the dictionary’s own touch-target rule requires one for icon-only buttons. This produces an unlabeled control in exactly the pattern that downstream implementations are told to copy.
   Fix: Add an accessible name to both menu trigger examples, e.g. `aria-label="Open row actions"`.

2. `/tmp/codex-brief.md:907` — **The new tabs pattern does not move focus when Arrow/Home/End changes the active tab**
   The examples update `active` state on arrow keys, but never shift DOM focus to the newly active tab. That breaks the promised roving-tabindex behavior and yields incomplete keyboard navigation in both sections.
   Fix: Store tab refs and call `.focus()` for the next/previous/first/last tab whenever keyboard navigation changes the active index.

3. `/tmp/codex-brief.md:776` — **The new dialog/menu/tabs patterns do not include reduced-motion handling, violating the dictionary’s own all-pattern requirement**
   The review checklist requires every pattern to include reduced-motion handling, but the three newly added patterns in both sections contain no `motion-reduce:*` utilities or `@media (prefers-reduced-motion: reduce)` blocks. That breaks the stated parity/rule set introduced by this rework.
   Fix: Add reduced-motion fallbacks to all six new pattern implementations, or narrow the requirement so it only applies to patterns that actually animate or transition.

4. `/tmp/codex-brief.md:1260` — **The CSS Modules dialog example cannot reliably return focus to its trigger**
   Unlike the Tailwind version, the CSS Modules example conditionally renders either the trigger or the dialog. When the dialog opens, the trigger button unmounts, so `triggerRef.current` is cleared and the cleanup path cannot reliably restore focus to the trigger it claims to return to.
   Fix: Keep the trigger mounted while the dialog is open, or store a stable opener element reference that remains focusable after close.

### Verdict
REVISE
