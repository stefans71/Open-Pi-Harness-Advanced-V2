#!/usr/bin/env python3
"""V4.6 Vision Self-Correction Test — Model looks at its own screenshot.

Reuses V4.4 raw HTML (already generated with guidelines).
Session 2: Playwright screenshots the raw → model sees screenshot + prompt + HTML → self-corrects.

No YAML checklist, no grep, no work order. Just eyes + prompt + code.

Output to condition-P-harness-v46/
"""

import json
import os
import re
import base64
import shutil
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

WORKDIR = Path("/root/autodl-tmp/pi-harness-stable")
PROMPTS_FILE = WORKDIR / "prompts" / "all-100-prompts.json"
RAW_DIR = WORKDIR / "condition-N-harness-v44"  # Reuse V4.4 raw output
OUTPUT_DIR = WORKDIR / "condition-P-harness-v46"
LLM_URL = "http://localhost:11434/v1/chat/completions"

TEST_IDS = [
    "component-002-run0",
    "component-003-run0",
    "component-008-run0",
    "component-010-run0",
    "component-015-run0",
    "component-032-run0",
    "component-035-run0",
    "component-044-run0",
    "component-052-run0",
    "component-053-run0",
]

EXPERT_PERSONA = (
    "You are an expert UI/UX designer reviewing your own work. "
    "You have deep expertise in typography hierarchy, spacing systems, color theory, "
    "and production-quality HTML/CSS."
)

# Playwright needs to be available on AutoDL
# If not, we can use the raw HTML without screenshot and just do text-based review
PLAYWRIGHT_AVAILABLE = False  # Set to True if Playwright is installed on AutoDL


def call_llm_vision(prompt_text, image_base64=None, max_tokens=32768):
    """Call llama-server with optional image input."""
    messages = [{"role": "user", "content": []}]

    if image_base64:
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{image_base64}"}
        })

    messages[0]["content"].append({
        "type": "text",
        "text": prompt_text
    })

    payload = json.dumps({
        "model": "qwen3.6-27b-mtp",
        "messages": messages,
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


def screenshot_html(html_path, png_path):
    """Take a screenshot of the HTML file using Playwright."""
    try:
        result = subprocess.run(
            ["node", "-e", f"""
const pw = require('playwright');
(async () => {{
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({{width: 1280, height: 900}});
  await page.goto('file://{html_path}', {{waitUntil: 'networkidle'}});
  await page.waitForTimeout(2000);
  await page.screenshot({{path: '{png_path}', fullPage: true}});
  await browser.close();
}})();
"""],
            capture_output=True, text=True, timeout=30
        )
        return os.path.exists(png_path)
    except Exception:
        return False


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    if comp_dir.exists():
        shutil.rmtree(comp_dir)
    comp_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    # Get V4.4 raw HTML
    raw_path = RAW_DIR / comp_id / "harness-output.html"
    if not raw_path.exists():
        print(f"  SKIP: no V4.4 raw for {comp_id}", flush=True)
        return False

    raw_html = raw_path.read_text(errors="ignore")
    raw_size = len(raw_html.encode())
    shutil.copy2(raw_path, artifact_dir / "raw-output.html")

    # Screenshot the raw HTML
    png_path = str(artifact_dir / "raw-screenshot.png")
    image_base64 = None

    if PLAYWRIGHT_AVAILABLE:
        print(f"  Screenshotting raw HTML...", flush=True)
        if screenshot_html(str(raw_path), png_path):
            with open(png_path, "rb") as f:
                image_base64 = base64.b64encode(f.read()).decode()
            print(f"  Screenshot: {os.path.getsize(png_path)} bytes", flush=True)
        else:
            print(f"  WARN: screenshot failed, using text-only review", flush=True)

    # Session 2: Vision self-correction
    print(f"  Vision review ({'with screenshot' if image_base64 else 'text-only'})...", flush=True)

    review_prompt = f"""{EXPERT_PERSONA}

ORIGINAL PROMPT (what was requested):
---
{prompt_text}
---

{"Look at the screenshot of your output above. " if image_base64 else ""}Review the HTML below against the original prompt.

Check:
- Does the layout match what was asked for? (correct component type, correct scope)
- Are prices, labels, colors factually correct per the prompt?
- Is typography hierarchy clear? (display text large, body readable, captions small)
- Are interactive states present? (hover, focus, disabled)
- Is spacing balanced and consistent? Do NOT inflate padding if it's already good.
- Do shadows and glow effects look clean?

Fix any issues you find. Do NOT change things that already look good — only fix actual problems.

CURRENT HTML:
```html
{raw_html}
```

Output the complete fixed HTML file."""

    start = time.time()
    ok, response = call_llm_vision(review_prompt, image_base64)
    elapsed = time.time() - start

    if ok and response:
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
            polished_path = comp_dir / "harness-output.html"
            polished_path.write_text(html_content)
            shutil.copy2(polished_path, artifact_dir / "index.html")
            polished_size = len(html_content.encode())
            delta = polished_size - raw_size
            print(f"  Polished: {polished_size} bytes ({'+' if delta >= 0 else ''}{delta}), {elapsed:.0f}s", flush=True)
        else:
            print(f"  WARN: no valid HTML, using raw", flush=True)
            shutil.copy2(raw_path, comp_dir / "harness-output.html")
    else:
        print(f"  FAIL: {str(response)[:100]}", flush=True)
        shutil.copy2(raw_path, comp_dir / "harness-output.html")

    print(f"  OK {comp_id}: {elapsed:.0f}s", flush=True)
    return True


def main():
    mode = "vision" if PLAYWRIGHT_AVAILABLE else "text-only (no Playwright)"
    print(f"=== V4.6 Vision Self-Correction Test ({len(TEST_IDS)} prompts) ===", flush=True)
    print(f"Mode: {mode}", flush=True)
    print(f"Raw source: {RAW_DIR}", flush=True)
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
