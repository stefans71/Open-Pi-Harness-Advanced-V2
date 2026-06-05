#!/usr/bin/env python3
"""V4.2 Split Pipeline — Raw generate + YAML work order polish.

Session 1: Raw generate from prompt (no dictionary, no constraints)
Bash: 21-item production checklist
Session 2: Direct API polish with YAML work order + sign-off

Updates over V4.1:
  - Dictionary: 58 rules, 11 categories (added CD color direction, LS-07 CTA, VD-05, TY-08)
  - Checklist: 21 items (added display_size, cta_saturated)
  - Output: condition-L-harness-v42/
"""

import json
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

WORKDIR = Path("/root/autodl-tmp/pi-harness-stable")
PROMPTS_FILE = WORKDIR / "prompts" / "all-100-prompts.json"
OUTPUT_DIR = WORKDIR / "condition-M-harness-v42"
DICTIONARY = ".pi/ux-production-standards.md"
TIMEOUT = 1200  # 20 min per pi call (generous)
MIN_TOKEN_REFS = 5

TEST_IDS = [
    "component-000-run0",
    "component-001-run0",
    "component-004-run0",
    "component-005-run0",
    "component-006-run0",
    "component-007-run0",
    "component-009-run0",
    "component-011-run0",
    "component-012-run0",
    "component-013-run0",
    "component-014-run0",
    "component-016-run0",
    "component-017-run0",
    "component-018-run0",
    "component-019-run0",
    "component-020-run0",
    "component-021-run0",
    "component-022-run0",
    "component-023-run0",
    "component-024-run0",
    "component-025-run0",
    "component-026-run0",
    "component-028-run0",
    "component-029-run0",
    "component-030-run0",
    "component-031-run0",
    "component-032-run0",
    "component-033-run0",
    "component-034-run0",
    "component-036-run0",
    "component-037-run0",
    "component-038-run0",
    "component-039-run0",
    "component-041-run0",
    "component-042-run0",
    "component-045-run0",
    "component-046-run0",
    "component-047-run0",
]

PATH = "/root/autodl-tmp/node-v22.15.0-linux-x64/bin:/root/autodl-tmp/bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def kill_everything():
    """Kill ALL pi and python batch processes except ourselves."""
    my_pid = os.getpid()
    try:
        subprocess.run(["pkill", "-f", "pi "], capture_output=True)
        # Kill other python batch scripts (not us)
        result = subprocess.run(["pgrep", "-f", "run-v4"], capture_output=True, text=True)
        for line in result.stdout.strip().split("\n"):
            pid = line.strip()
            if pid and int(pid) != my_pid:
                try:
                    os.kill(int(pid), signal.SIGKILL)
                except Exception:
                    pass
        time.sleep(3)
    except Exception:
        pass


def kill_stale_pi():
    try:
        subprocess.run(["pkill", "-f", "pi "], capture_output=True)
        time.sleep(3)
    except Exception:
        pass


def validate_output(html_path, prompt_text):
    """Check that the HTML output relates to the prompt."""
    html = html_path.read_text(errors="ignore").lower()
    prompt_lower = prompt_text.lower()

    # Extract key nouns from prompt (4+ char words, skip common ones)
    common = {"that", "this", "with", "from", "have", "your", "will", "should",
              "make", "each", "when", "them", "into", "more", "only", "also",
              "than", "been", "like", "some", "what", "about", "just", "self",
              "show", "dark", "light", "style", "inline", "external", "contained",
              "html", "document", "libraries", "using", "background"}
    words = set(re.findall(r'\b[a-z]{4,}\b', prompt_lower)) - common
    found = sum(1 for w in words if w in html)

    if found < 3:
        return False, f"only {found} prompt words found in HTML (need 3+): {words}"
    return True, f"{found} prompt words matched"


def run_pi(prompt_text, cwd=None):
    """Run a single pi -p command. Returns (success, output_text)."""
    # Escape single quotes in prompt for safe bash passing
    escaped = prompt_text.replace("'", "'\\''")
    cmd = f"pi -p '{escaped}'"
    env = os.environ.copy()
    env["PATH"] = PATH

    try:
        proc = subprocess.Popen(
            ["bash", "-c", cmd],
            cwd=str(cwd or WORKDIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid,
        )
        try:
            stdout, _ = proc.communicate(timeout=TIMEOUT)
            return True, stdout.decode(errors="ignore")
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait()
            return False, "TIMEOUT"
    except Exception as e:
        return False, str(e)


def call_llm_direct(prompt_text, max_tokens=32768):
    """Call llama-server directly via API. Returns the response text."""
    import urllib.request
    import urllib.error

    payload = json.dumps({
        "model": "qwen3.6-27b-mtp",
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }).encode()

    req = urllib.request.Request(
        "http://localhost:11434/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
            text = data["choices"][0]["message"]["content"]
            return True, text
    except Exception as e:
        return False, str(e)


def run_checklist(html_path, prompt_text=""):
    """Production checklist — higher standards so polish always runs."""
    text = html_path.read_text(errors="ignore")
    prompt_lower = prompt_text.lower()

    # TY-08: only require display-size text for components that HAVE prices/headlines
    needs_display = any(w in prompt_lower for w in ["price", "pricing", "$", "headline", "hero", "heading", "plan", "subscribe", "per month", "/month"])

    checks = {
        "has_tokens": text.count("var(--") >= 20,
        "has_hover": text.count(":hover") >= 4,
        "has_focus_visible": text.count("focus-visible") >= 2,
        "has_active": ":active" in text and ("scale" in text or "darken" in text or "brightness" in text),
        "has_disabled": ":disabled" in text and ("opacity" in text or "not-allowed" in text),
        "has_transitions": text.count("transition") >= 3 and "ease" in text,
        "has_reduced_motion": "prefers-reduced-motion" in text,
        "has_responsive": "@media" in text and ("768" in text or "48rem" in text) and ("1024" in text or "64rem" in text),
        "has_svg_icons": text.count("<svg") >= 2,
        "has_aria": text.count("aria-") >= 2,
        "has_multi_shadow": text.count("box-shadow") >= 3,
        "has_hover_lift": "translateY" in text and ":hover" in text,
        "has_letter_spacing": "letter-spacing" in text,
        "has_word_break": "word-break" in text or "overflow" in text,
        "has_display_size": bool(re.search(r'font-size:\s*(3|3\.\d|4|4\.\d|5)\d*rem|font-size:\s*(48|5[0-9]|6[0-9]|7[0-9])px|clamp\(2\.5rem', text)) if needs_display else True,
        "has_green_checks": ("#10B981" in text or "#10b981" in text or "#22c55e" in text or "#34d399" in text or "green" in text.lower()) if ("<svg" in text and ("check" in text.lower() or "polyline" in text)) else True,
        "has_clean_glow": not ("box-shadow" in text and "60px" in text and "0.5" in text),
        "has_solid_headings": "-webkit-text-fill-color: transparent" not in text,
        "has_price_flow": (text.find("tagline") == -1 or text.find("tagline") > text.find("price")) if ("price" in text and "plan" in text) else True,
        "has_cta_saturated": bool(re.search(r'button[^}]*background[^}]*(#[2-9a-f][0-9a-f]{5}|rgb\(\s*[0-9]{1,2}\s*,|hsl\(\s*\d)', text, re.IGNORECASE | re.DOTALL)) if "button" in text else True,
        "has_visible_shadow": bool(re.search(r'box-shadow:[^;]*(8|10|12|16|20|24)\d*px', text)),
    }

    missing = [k.replace("has_", "") for k, v in checks.items() if not v]
    return checks, missing


def build_fixes_yaml(missing_items):
    """Build a YAML work order from missing checklist items."""
    fix_map = {
        "tokens": {"id": "CR-TOK", "css": ":root { --var declarations }", "instruction": "Add CSS custom properties (:root) for ALL colors, spacing, radii. Name them to evoke the domain."},
        "hover": {"id": "IS-01", "css": ":hover { }", "instruction": "Add :hover with background-color change or opacity change + transition 150ms ease-out on EVERY clickable element (buttons, links, cards). Minimum 4 :hover rules."},
        "focus_visible": {"id": "IS-02", "css": ":focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }", "instruction": "Add :focus-visible with 2px outline on ALL interactive elements. Minimum 2 rules."},
        "active": {"id": "IS-03", "css": ":active { transform: scale(0.97); }", "instruction": "Add :active with scale(0.97) or brightness change on all buttons."},
        "disabled": {"id": "IS-04", "css": ":disabled { opacity: 0.4; cursor: not-allowed; }", "instruction": "Add :disabled styles with opacity 0.4 and cursor not-allowed."},
        "transitions": {"id": "IS-05", "css": "transition: all 150ms ease-out;", "instruction": "Add transition: all 150ms ease-out on all interactive elements. Minimum 3 transition declarations."},
        "reduced_motion": {"id": "AM-03", "css": "@media (prefers-reduced-motion: reduce) { ... }", "instruction": "Add @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }"},
        "responsive": {"id": "LS-04", "css": "@media (min-width: 768px) { } @media (min-width: 1024px) { }", "instruction": "Add responsive breakpoints at 768px and 1024px with layout adjustments."},
        "svg_icons": {"id": "CR-01", "css": "<svg viewBox='0 0 24 24'>...</svg>", "instruction": "Replace ALL emoji/text checkmarks (✓ ✗ → ★ •) with inline <svg> elements. Draw real SVG paths. Minimum 2 SVG icons."},
        "aria": {"id": "ACC-01", "css": "aria-label='...'", "instruction": "Add aria-label on icon-only buttons and non-text interactive elements. Minimum 2 aria attributes."},
        "multi_shadow": {"id": "CR-02", "css": "box-shadow: 0 1px 2px rgba(), 0 4px 12px rgba(), inset 0 1px 0 rgba();", "instruction": "Add multi-layer box-shadow (3 shadows stacked) on cards/elevated elements."},
        "hover_lift": {"id": "CR-05", "css": ":hover { transform: translateY(-1px); }", "instruction": "Add translateY(-1px) on hover for buttons and cards. Pair with shadow expansion."},
        "letter_spacing": {"id": "CR-04", "css": "letter-spacing: -0.02em;", "instruction": "Add negative letter-spacing (-0.02em to -0.04em) on display text >= 32px."},
        "word_break": {"id": "CR-07", "css": "word-break: break-word; overflow-wrap: break-word;", "instruction": "Add word-break: break-word on feature lists and content text."},
        "display_size": {"id": "TY-08", "css": "font-size: clamp(2.5rem, 5vw, 3.5rem);", "instruction": "Hero headlines, prices, and primary numbers must be >= 48px (3rem). Use clamp(2.5rem, 5vw, 3.5rem) for responsive display text. The price/headline must be the visually dominant element on the page."},
        "cta_saturated": {"id": "LS-07", "css": "background: #2563EB; /* saturated blue */", "instruction": "The primary CTA button must use a saturated, high-contrast color — indigo (#5046E5), blue (#2563EB), or green (#059669). Not teal, gray, or pastels. The CTA must visually pop against the background."},
        "visible_shadow": {"id": "VD-05", "css": "box-shadow: 0 4px 6px rgba(0,0,0,0.07), 0 12px 24px rgba(0,0,0,0.09);", "instruction": "Cards must have visible shadow elevation. Shadow spread >= 8px with opacity >= 0.08. The card must be visually distinct from the background at arm's length."},
        "price_flow": {"id": "CP-05", "css": ".plan-name + .price-block { } /* no tagline between */", "instruction": "Pricing card flow: plan name → price → divider → features → CTA. Remove any tagline/description between the plan name and price. Price amount and period must be on the same baseline (display: flex; align-items: baseline). Move tagline below the divider or remove it. Never use <br> for text wrapping."},
        "green_checks": {"id": "CR-08", "css": "stroke: #10B981; or color: #10B981;", "instruction": "Change all checkmark/success/included SVG icons to green (#10B981). Do NOT use the theme accent color for checkmarks — green means 'yes/included' universally."},
        "clean_glow": {"id": "CR-09", "css": "box-shadow: 0 0 40px rgba(purple, 0.25); /* visible edge glow */", "instruction": "Glow should be visible but clean — opacity 0.15-0.35 on outer edge via box-shadow or ::before. The card SURFACE must be solid (no glow bleeding through the face). Do NOT reduce glow below 0.15 — it must be visible if the design includes it."},
        "solid_headings": {"id": "CR-10", "css": "color: #f1f5f9; /* solid, no gradient */", "instruction": "Remove -webkit-background-clip: text and -webkit-text-fill-color: transparent from headings. Use a solid text color (white or near-white on dark themes). No gradient text on plan names or product titles."},
    }

    yaml_lines = ["fixes:"]
    for item in missing_items:
        fix = fix_map.get(item, {"id": item, "css": "", "instruction": f"Fix {item}"})
        yaml_lines.append(f"  - id: {fix['id']}")
        yaml_lines.append(f"    item: {item}")
        yaml_lines.append(f"    css_example: \"{fix['css']}\"")
        yaml_lines.append(f"    instruction: \"{fix['instruction']}\"")
        yaml_lines.append(f"    sign_off: false")

    return "\n".join(yaml_lines)


def build_polish_prompt(raw_path, missing_items):
    """Build the polish prompt with YAML work order and sign-off."""

    raw_html = Path(raw_path).read_text(errors="ignore")
    fixes_yaml = build_fixes_yaml(missing_items)

    return f"""You are a senior frontend engineer. You have a WORK ORDER to apply production fixes to an HTML component.

WORK ORDER (YAML):
```yaml
{fixes_yaml}
```

CURRENT HTML TO FIX:
```html
{raw_html}
```

INSTRUCTIONS:
1. Read each fix in the work order
2. Apply the fix to the HTML using the css_example as a guide
3. Every fix MUST be applied — you cannot skip any
4. After applying ALL fixes, output the complete HTML

OUTPUT FORMAT — you MUST output in this exact format:

```html
<!DOCTYPE html>
... (complete rewritten HTML with all fixes applied) ...
</html>
```

```yaml
sign_off:
  - id: {missing_items[0] if missing_items else 'none'}
    applied: true
    what_changed: "description of what you added"
... (one entry per fix)
```

RULES:
- Keep the same layout, structure, content, labels, and prices
- Do NOT add new sections, pages, or components
- Do NOT change the color scheme direction
- The HTML output MUST be larger than the input — you are ADDING code
- Every css_example in the work order must appear in your output HTML"""


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    if (comp_dir / "harness-output.html").exists():
        text = (comp_dir / "harness-output.html").read_text(errors="ignore")
        tokens = text.count("var(--")
        if tokens >= MIN_TOKEN_REFS:
            size = len(text.encode())
            print(f"  SKIP: already done ({size} bytes, {tokens} tokens)", flush=True)
            return True

    if comp_dir.exists():
        shutil.rmtree(comp_dir)
    comp_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    # ── SESSION 1: Raw Generate ──────────────────────────────────────
    kill_stale_pi()

    # Clean any leftover index.html
    cwd_index = WORKDIR / "index.html"
    if cwd_index.exists():
        cwd_index.unlink()

    generate_prompt = (
        f"Build this UI component as a single self-contained HTML file. "
        f"Write ONE file: index.html. Start with <!DOCTYPE html>, end with </html>. "
        f"ALL CSS in a <style> block. No external CDN or frameworks. "
        f"Use CSS custom properties (:root) for colors and spacing. "
        f"Build ONLY what is requested — if asked for a single component, build only that component centered on the page. "
        f"Do NOT add extra sections, dashboards, tables, or mock data around it. "
        f"{prompt_text}"
    )

    print(f"  [1/2] Raw generate...", flush=True)
    start1 = time.time()
    ok, output = run_pi(generate_prompt)
    elapsed1 = time.time() - start1

    if not ok:
        print(f"  FAIL raw generate: {output[:200]}", flush=True)
        return False

    if not cwd_index.exists():
        print(f"  FAIL: no index.html after generate (pi returned ok but no file)", flush=True)
        return False

    if cwd_index.stat().st_size < 500:
        print(f"  FAIL: index.html too small ({cwd_index.stat().st_size} bytes)", flush=True)
        return False

    # Validate output matches prompt
    valid, reason = validate_output(cwd_index, prompt_text)
    if not valid:
        print(f"  CONTAMINATED: {reason}", flush=True)
        cwd_index.unlink()
        return False

    raw_size = cwd_index.stat().st_size
    raw_text = cwd_index.read_text(errors="ignore")
    raw_tokens = raw_text.count("var(--")
    raw_hovers = raw_text.count(":hover")
    raw_svgs = raw_text.count("<svg")

    # Save raw output
    shutil.copy2(cwd_index, artifact_dir / "raw-output.html")
    print(f"  Raw: {raw_size} bytes, {raw_tokens} tokens, {raw_hovers} hovers, {raw_svgs} svgs, {elapsed1:.0f}s", flush=True)

    # ── BASH CHECKLIST ────────────────────────────────────────────────
    checks, missing = run_checklist(cwd_index, prompt_text)
    checklist_report = f"# Production Checklist\n\n"
    for k, v in checks.items():
        status = "PASS" if v else "MISSING"
        checklist_report += f"- {k}: {status}\n"
    checklist_report += f"\nMissing items: {', '.join(missing) if missing else 'none'}\n"
    (artifact_dir / "checklist.md").write_text(checklist_report)
    print(f"  Checklist: {len(checks) - len(missing)}/{len(checks)} pass, missing: {', '.join(missing) if missing else 'none'}", flush=True)

    # ── SESSION 2: Polish (only if checklist has failures) ────────────
    elapsed2 = 0
    if not missing:
        print(f"  All checks passed — skipping polish", flush=True)
        shutil.copy2(cwd_index, comp_dir / "harness-output.html")
        shutil.copy2(cwd_index, artifact_dir / "index.html")
        (artifact_dir / "rework-summary.md").write_text("No polish needed — all checks passed.\n")
    else:
        kill_stale_pi()

        polish_prompt = build_polish_prompt(
            str(artifact_dir / "raw-output.html"),
            missing
        )

        print(f"  [2/2] Polish ({len(missing)} items) via direct API...", flush=True)
        start2 = time.time()
        ok2, response = call_llm_direct(polish_prompt)
        elapsed2 = time.time() - start2

        if ok2 and response:
            # Extract HTML from response (model wraps in ```html ... ```)
            html_content = None
            if "```html" in response:
                parts = response.split("```html", 1)
                if len(parts) > 1:
                    html_content = parts[1].split("```", 1)[0].strip()

            if not html_content:
                # Try raw extraction
                idx = response.find("<!DOCTYPE")
                if idx == -1:
                    idx = response.find("<html")
                end = response.rfind("</html>")
                if idx >= 0 and end > idx:
                    html_content = response[idx:end + 7].strip()

            if html_content and (html_content.startswith("<!DOCTYPE") or html_content.startswith("<html")):
                cwd_index.write_text(html_content)

                # Extract sign-off YAML if present
                if "```yaml" in response:
                    yaml_part = response.split("```yaml", 1)
                    if len(yaml_part) > 1:
                        sign_off = yaml_part[1].split("```", 1)[0].strip()
                        (artifact_dir / "sign-off.yaml").write_text(sign_off)
                        sign_count = sign_off.count("applied: true")
                        print(f"  Sign-off: {sign_count}/{len(missing)} items confirmed", flush=True)
            else:
                print(f"  WARN: no valid HTML in response ({len(response)} chars), using raw", flush=True)
                shutil.copy2(artifact_dir / "raw-output.html", cwd_index)
        else:
            print(f"  FAIL polish API: {str(response)[:100] if response else 'empty'}", flush=True)
            shutil.copy2(artifact_dir / "raw-output.html", cwd_index)

        polished_size = cwd_index.stat().st_size
        polished_text = cwd_index.read_text(errors="ignore")
        polished_tokens = polished_text.count("var(--")
        polished_hovers = polished_text.count(":hover")
        polished_svgs = polished_text.count("<svg")
        polished_focus = polished_text.count("focus-visible")

        shutil.copy2(cwd_index, comp_dir / "harness-output.html")
        shutil.copy2(cwd_index, artifact_dir / "index.html")

        # Rework summary
        summary = f"# Polish Summary\n\n"
        summary += f"Raw: {raw_size} bytes, {raw_tokens} tokens, {raw_hovers} hovers, {raw_svgs} svgs\n"
        summary += f"Polished: {polished_size} bytes, {polished_tokens} tokens, {polished_hovers} hovers, {polished_svgs} svgs, {polished_focus} focus-visible\n"
        summary += f"Delta: +{polished_size - raw_size} bytes, +{polished_tokens - raw_tokens} tokens\n"
        summary += f"Polish time: {elapsed2:.0f}s\n"
        summary += f"Items fixed: {', '.join(missing)}\n"
        (artifact_dir / "rework-summary.md").write_text(summary)

        print(f"  Polished: {polished_size} bytes (+{polished_size - raw_size}), {polished_tokens} tokens, {polished_hovers} hovers, {polished_svgs} svgs, {elapsed2:.0f}s", flush=True)

    # Final stats
    final = comp_dir / "harness-output.html"
    final_text = final.read_text(errors="ignore")
    final_size = final.stat().st_size
    final_tokens = final_text.count("var(--")
    final_svgs = final_text.count("<svg")
    final_hovers = final_text.count(":hover")
    total_time = elapsed1 + (elapsed2 if missing else 0)

    # Save structured timing + metrics
    timing = {
        "id": comp_id,
        "raw_generate_s": round(elapsed1, 1),
        "polish_s": round(elapsed2, 1) if missing else 0,
        "total_s": round(total_time, 1),
        "raw_size": raw_size,
        "raw_tokens": raw_tokens,
        "raw_hovers": raw_hovers,
        "raw_svgs": raw_svgs,
        "polished_size": final_size,
        "polished_tokens": final_tokens,
        "polished_hovers": final_hovers,
        "polished_svgs": final_svgs,
        "checklist_pass": len(checks) - len(missing),
        "checklist_total": len(checks),
        "checklist_missing": missing,
        "polish_needed": bool(missing),
        "validated": True,
    }
    (artifact_dir / "timing.json").write_text(json.dumps(timing, indent=2))

    print(f"  OK {comp_id}: {final_size} bytes (raw {raw_size}), {final_tokens} tokens, {final_svgs} SVGs, {final_hovers} hovers, {total_time:.0f}s", flush=True)
    return True


def main():
    # Kill any competing processes first
    kill_everything()

    print(f"=== V4.1 Split Pipeline ({len(TEST_IDS)} prompts) ===", flush=True)
    print(f"Start: {time.strftime('%H:%M:%S')}", flush=True)
    print(f"Output: {OUTPUT_DIR}", flush=True)
    print(f"Architecture: raw generate → bash checklist → polish (if needed)", flush=True)
    print(flush=True)

    with open(PROMPTS_FILE) as f:
        all_prompts = json.load(f)
    prompt_map = {p["id"]: p["prompt"] for p in all_prompts}

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ok = 0
    fail = 0

    for i, comp_id in enumerate(TEST_IDS, 1):
        print(f"[{i}/{len(TEST_IDS)}] {time.strftime('%H:%M:%S')} {comp_id}", flush=True)

        if comp_id not in prompt_map:
            print(f"  ERROR: not in prompts", flush=True)
            fail += 1
            continue

        try:
            if run_one(comp_id, prompt_map[comp_id]):
                ok += 1
            else:
                fail += 1
        except Exception as e:
            print(f"  CRASH: {e}", flush=True)
            fail += 1

        print(flush=True)

    print(f"=== DONE: {ok} ok, {fail} failed ===", flush=True)
    print(f"End: {time.strftime('%H:%M:%S')}", flush=True)


if __name__ == "__main__":
    main()
