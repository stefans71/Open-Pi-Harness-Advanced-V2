#!/usr/bin/env python3
"""V4.5 Test — Guidelines as YAML checklist with sign-off.

Session 1: Expert persona + 10-line UX guidelines + prompt → raw HTML
Session 2: Direct API — persona + prompt + raw HTML + YAML REVIEW CHECKLIST
           Model checks each standard, decides if it's met or needs fixing,
           signs off on each one. Model judges, not grep.

Output to condition-O-harness-v45/
"""

import json
import os
import re
import shutil
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

WORKDIR = Path("/root/autodl-tmp/pi-harness-stable")
PROMPTS_FILE = WORKDIR / "prompts" / "all-100-prompts.json"
OUTPUT_DIR = WORKDIR / "condition-O-harness-v45"
TIMEOUT = 1200
LLM_URL = "http://localhost:11434/v1/chat/completions"

TEST_IDS = [
    "component-000-run0", "component-001-run0", "component-004-run0", "component-005-run0",
    "component-006-run0", "component-007-run0", "component-009-run0", "component-011-run0",
    "component-012-run0", "component-013-run0", "component-014-run0", "component-016-run0",
    "component-017-run0", "component-018-run0", "component-019-run0", "component-020-run0",
    "component-021-run0", "component-022-run0", "component-023-run0", "component-024-run0",
    "component-025-run0", "component-026-run0", "component-027-run0", "component-028-run0",
    "component-029-run0", "component-030-run0", "component-031-run0", "component-033-run0",
    "component-034-run0", "component-036-run0", "component-037-run0", "component-038-run0",
    "component-039-run0", "component-040-run0", "component-041-run0", "component-042-run0",
    "component-043-run0", "component-045-run0", "component-046-run0", "component-047-run0",
    "component-048-run0", "component-049-run0", "component-050-run0", "component-051-run0",
    "component-054-run0", "component-055-run0", "component-056-run0", "component-057-run0",
    "component-058-run0", "component-059-run0", "component-060-run0", "component-061-run0",
    "component-062-run0", "component-063-run0", "component-064-run0", "component-065-run0",
    "component-066-run0", "component-067-run0", "component-068-run0", "component-069-run0",
    "component-070-run0", "component-071-run0", "component-072-run0", "component-073-run0",
    "component-074-run0", "component-075-run0", "component-076-run0", "component-077-run0",
    "component-078-run0", "component-079-run0", "component-080-run0", "component-081-run0",
    "component-082-run0", "component-083-run0", "component-084-run0", "component-085-run0",
    "component-086-run0", "component-087-run0", "component-088-run0", "component-089-run0",
    "component-090-run0", "component-091-run0", "component-092-run0", "component-093-run0",
    "component-094-run0", "component-095-run0", "component-096-run0", "component-097-run0",
    "component-098-run0", "component-099-run0",
]

PATH = "/root/autodl-tmp/node-v22.15.0-linux-x64/bin:/root/autodl-tmp/bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"

EXPERT_PERSONA = (
    "You are an expert UI/UX designer and senior frontend engineer. "
    "You have deep expertise in typography hierarchy, spacing systems, color theory, "
    "and production-quality HTML/CSS. You build components that look like they belong "
    "on Vercel, Linear, or Stripe — clean, polished, intentional."
)

UX_GUIDELINES_TEXT = """Follow these 10 production UX standards:
1. Typography hierarchy — display text (prices, headlines) >= 48px, body 16px, captions 12-14px. Clear size jumps between levels.
2. Spacing rhythm — 8px grid. Section gaps 48px, card padding 24px min. Consistent, not random.
3. Inline SVG icons — checkmarks, arrows, close buttons as <svg>, never emoji or text characters.
4. Interactive states on EVERY clickable — hover (color shift + 150ms transition), focus-visible (2px outline), active (scale 0.97), disabled (opacity 0.4).
5. Color contrast — WCAG AA 4.5:1. CTA button must be the most saturated, high-contrast element.
6. Shadows contained — multi-layer box-shadow for depth on cards. Glow on outer edge only, never bleeding through the card face.
7. Reduced motion — always include @media (prefers-reduced-motion: reduce).
8. CSS custom properties — all colors, spacing, radii as :root variables. Name them to evoke the domain.
9. Responsive — mobile-first base styles, @media for 768px and 1024px. Adjust layout direction and max-width, NOT padding.
10. Accessibility — aria-labels on icon-only buttons, semantic HTML (article, nav, button, ul)."""

UX_REVIEW_YAML = """ux_review:
  - id: TY
    standard: "Typography hierarchy — display text (prices, headlines) >= 48px, body 16px, captions 12-14px. Clear size jumps."
    status: false
    action: ""
  - id: SP
    standard: "Spacing rhythm — 8px grid, section gaps 48px, card padding 24px min. Do NOT inflate padding if already balanced."
    status: false
    action: ""
  - id: IC
    standard: "Inline SVG icons — checkmarks, arrows, close buttons as <svg>, never emoji or text characters."
    status: false
    action: ""
  - id: IS
    standard: "Interactive states — hover (color shift + 150ms), focus-visible (2px outline), active (scale 0.97), disabled (opacity 0.4) on EVERY clickable."
    status: false
    action: ""
  - id: CC
    standard: "Color contrast — WCAG AA 4.5:1. CTA button must be the most saturated element. Match prompt color requests."
    status: false
    action: ""
  - id: SH
    standard: "Shadows contained — multi-layer box-shadow for depth. Glow on outer edge only, never bleeding through card face."
    status: false
    action: ""
  - id: RM
    standard: "Reduced motion — @media (prefers-reduced-motion: reduce) with 0.01ms durations."
    status: false
    action: ""
  - id: CP
    standard: "CSS custom properties — all colors, spacing, radii as :root variables. Domain-evocative names."
    status: false
    action: ""
  - id: RS
    standard: "Responsive — mobile-first, @media for 768px and 1024px. Adjust layout direction and max-width ONLY, NOT padding."
    status: false
    action: ""
  - id: AC
    standard: "Accessibility — aria-labels on icon-only buttons, semantic HTML (article, nav, button, ul)."
    status: false
    action: ""
  - id: HL
    standard: "Hover lift — cards and buttons shift up translateY(-1px) or translateY(-2px) with shadow expansion on hover. Creates tactile, physical feel."
    status: false
    action: ""
  - id: PA
    standard: "Prompt adherence — verify all prices, labels, colors, features match the original prompt exactly."
    status: false
    action: \"\""""


def kill_stale():
    try:
        subprocess.run(["pkill", "-f", "pi "], capture_output=True)
        time.sleep(3)
    except Exception:
        pass


def run_pi(prompt_text):
    escaped = prompt_text.replace("'", "'\\''")
    cmd = f"pi -p '{escaped}'"
    env = os.environ.copy()
    env["PATH"] = PATH

    try:
        proc = subprocess.Popen(
            ["bash", "-c", cmd],
            cwd=str(WORKDIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid,
        )
        try:
            stdout, _ = proc.communicate(timeout=TIMEOUT)
            return True
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait()
            return False
    except Exception:
        return False


def call_llm_direct(prompt_text, max_tokens=32768):
    payload = json.dumps({
        "model": "qwen3.6-27b-mtp",
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }).encode()

    req = urllib.request.Request(
        LLM_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
            return True, data["choices"][0]["message"]["content"]
    except Exception as e:
        return False, str(e)


def run_checklist_analysis(html_path, prompt_text=""):
    """Run V4.2C checklist for comparison ONLY."""
    text = html_path.read_text(errors="ignore")
    prompt_lower = prompt_text.lower()
    needs_display = any(w in prompt_lower for w in ["price", "pricing", "$", "headline", "hero", "heading", "plan", "subscribe", "/month"])

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
        "has_green_checks": True,
        "has_clean_glow": True,
        "has_solid_headings": "-webkit-text-fill-color: transparent" not in text,
        "has_cta_saturated": True,
        "has_visible_shadow": bool(re.search(r'box-shadow:[^;]*(8|10|12|16|20|24)\d*px', text)),
    }

    passed = sum(1 for v in checks.values() if v)
    total = len(checks)
    missing = [k.replace("has_", "") for k, v in checks.items() if not v]
    return passed, total, missing


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    if comp_dir.exists():
        shutil.rmtree(comp_dir)
    comp_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    kill_stale()

    cwd_index = WORKDIR / "index.html"
    if cwd_index.exists():
        cwd_index.unlink()

    # ── SESSION 1: Generate with guidelines ──
    generate_prompt = (
        f"{EXPERT_PERSONA}\n\n"
        f"{UX_GUIDELINES_TEXT}\n\n"
        f"Build this UI component as a single self-contained HTML file. "
        f"Write ONE file: index.html. Start with <!DOCTYPE html>, end with </html>. "
        f"ALL CSS in a <style> block. No external CDN or frameworks. "
        f"Build ONLY what is requested — if asked for a single component, build only that component. "
        f"Do NOT add extra sections, dashboards, tables, or mock data.\n\n"
        f"{prompt_text}"
    )

    print(f"  [1/2] Generate (persona + guidelines)...", flush=True)
    start1 = time.time()
    ok = run_pi(generate_prompt)
    elapsed1 = time.time() - start1

    if not ok or not cwd_index.exists():
        print(f"  FAIL generate: {'timeout' if not ok else 'no index.html'}", flush=True)
        return False

    raw_size = cwd_index.stat().st_size
    raw_text = cwd_index.read_text(errors="ignore")
    shutil.copy2(cwd_index, artifact_dir / "raw-output.html")

    raw_passed, _, raw_missing = run_checklist_analysis(cwd_index, prompt_text)
    print(f"  Raw: {raw_size} bytes, checklist {raw_passed}/20, {elapsed1:.0f}s", flush=True)

    # ── SESSION 2: YAML review checklist with sign-off ──
    print(f"  [2/2] Polish (YAML review checklist + sign-off)...", flush=True)

    polish_prompt = f"""{EXPERT_PERSONA}

You have a UX REVIEW CHECKLIST. For each standard, check the HTML against it.
If it ALREADY MEETS the standard, set status: true and action: "already correct".
If it NEEDS FIXING, fix it in the HTML and set status: true with what you changed.
Do NOT change things that are already correct. Do NOT inflate padding or spacing.

ORIGINAL PROMPT (source of truth):
---
{prompt_text}
---

UX REVIEW CHECKLIST:
```yaml
{UX_REVIEW_YAML}
```

CURRENT HTML:
```html
{raw_text}
```

OUTPUT FORMAT — you MUST output in this exact format:

```html
<!DOCTYPE html>
... (complete HTML with any fixes applied) ...
</html>
```

```yaml
ux_review:
  - id: TY
    status: true
    action: "what you checked/fixed"
  - id: SP
    status: true
    action: "what you checked/fixed"
  ... (one entry per standard)
```"""

    start2 = time.time()
    ok2, response = call_llm_direct(polish_prompt)
    elapsed2 = time.time() - start2

    if ok2 and response:
        html_content = None
        if "```html" in response:
            parts = response.split("```html", 1)
            if len(parts) > 1:
                html_content = parts[1].split("```", 1)[0].strip()

        if not html_content:
            idx = response.find("<!DOCTYPE")
            if idx == -1:
                idx = response.find("<html")
            end = response.rfind("</html>")
            if idx >= 0 and end > idx:
                html_content = response[idx:end + 7].strip()

        if html_content and (html_content.startswith("<!DOCTYPE") or html_content.startswith("<html")):
            cwd_index.write_text(html_content)

            # Extract sign-off
            if "```yaml" in response:
                yaml_parts = response.split("```yaml")
                if len(yaml_parts) > 1:
                    sign_off = yaml_parts[-1].split("```", 1)[0].strip()
                    (artifact_dir / "sign-off.yaml").write_text(sign_off)
                    sign_count = sign_off.count("status: true")
                    print(f"  Sign-off: {sign_count}/12 standards confirmed", flush=True)
        else:
            print(f"  WARN: no valid HTML, using raw", flush=True)
    else:
        print(f"  FAIL polish: {str(response)[:100]}", flush=True)

    polished_size = cwd_index.stat().st_size
    delta = polished_size - raw_size
    shutil.copy2(cwd_index, comp_dir / "harness-output.html")
    shutil.copy2(cwd_index, artifact_dir / "index.html")

    pol_passed, _, pol_missing = run_checklist_analysis(cwd_index, prompt_text)

    summary = f"# V4.5 Review Summary\n\n"
    summary += f"Raw: {raw_size} bytes, checklist {raw_passed}/20\n"
    summary += f"Polished: {polished_size} bytes ({'+' if delta >= 0 else ''}{delta}), checklist {pol_passed}/20\n"
    summary += f"Generate: {elapsed1:.0f}s, Polish: {elapsed2:.0f}s, Total: {elapsed1+elapsed2:.0f}s\n"
    (artifact_dir / "rework-summary.md").write_text(summary)

    print(f"  Polished: {polished_size} bytes ({'+' if delta >= 0 else ''}{delta}), checklist {pol_passed}/20, {elapsed2:.0f}s", flush=True)
    print(f"  OK {comp_id}: total {elapsed1+elapsed2:.0f}s", flush=True)
    return True


def main():
    print(f"=== V4.5 YAML Review Checklist Test ({len(TEST_IDS)} prompts) ===", flush=True)
    print(f"Session 1: persona + guidelines + prompt", flush=True)
    print(f"Session 2: YAML review checklist — model JUDGES each standard + sign-off", flush=True)
    print(f"Output: {OUTPUT_DIR}", flush=True)
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


if __name__ == "__main__":
    main()
