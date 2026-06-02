#!/usr/bin/env python3
"""
Condition H — Run all 100 prompts via direct API (no harness) with Qwen3.6-27B.
Two-call pattern: brief → implement (same as bypass-test.py but for 100 prompts).
Outputs: condition-H-direct/<component-id>/direct-output.html + brief.txt

Usage: python3 batch-direct.py [--port 11434] [--start 0] [--count 100]
"""

import json
import os
import re
import sys
import time
import argparse
import urllib.request
import urllib.error
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

# Prompts: check multiple locations (VPS layout vs AutoDL flat copy)
_PROMPT_CANDIDATES = [
    SCRIPT_DIR / "prompts" / "all-100-prompts.json",
    Path("/root/autodl-tmp/all-100-prompts.json"),
    SCRIPT_DIR / "all-100-prompts.json",
]
PROMPTS_FILE = next((p for p in _PROMPT_CANDIDATES if p.exists()), _PROMPT_CANDIDATES[0])

# Results: write next to script if on VPS, or to /root/autodl-tmp/batch-results on AutoDL
RESULTS_DIR = SCRIPT_DIR / "condition-H-direct"
if not RESULTS_DIR.parent.exists():
    RESULTS_DIR = Path("/root/autodl-tmp/batch-results/27b-direct")

BRIEF_SYSTEM = """You are a senior web designer creating a design brief.

Write a concise design brief covering:
1. What to build (component type, purpose)
2. Color palette (3-5 colors as hex values, with a primary, secondary, accent)
3. Typography (font stack, heading vs body sizes)
4. Layout approach (flexbox/grid, responsive breakpoints)
5. Key interactive states (hover, focus, disabled)
6. Accessibility requirements (contrast, semantic HTML, focus-visible)

Keep it under 300 words. Be specific — hex values, px sizes, font names.
Output ONLY the brief text, no markdown fences."""

IMPLEMENT_TEMPLATE = """You are a frontend developer. Build exactly what the design brief describes.

DESIGN BRIEF:
{brief}

RULES:
- Output a SINGLE self-contained file as raw HTML
- Use ONLY inline CSS in a <style> block in <head>
- No external CDN, no Tailwind, no frameworks, no npm packages
- Minimum 3000 characters of meaningful HTML+CSS

QUALITY REQUIREMENTS:
- Mobile-first: base styles for 375px, @media for tablet (768px) and desktop (1024px)
- CSS custom properties in :root for all colors and spacing
- Hover, focus-visible, and active states on interactive elements
- Semantic HTML: use button, nav, main, section, form, label, h1-h6
- Touch targets: min-height 48px on tappable elements
- CSS transitions on state changes
- 4.5:1 contrast ratio for all text

Output ONLY the HTML. Start with <!DOCTYPE html> and end with </html>.
Do NOT wrap in markdown code fences. Do NOT add commentary."""


def call_api(api_url, model, prompt, max_tokens=4096, thinking=True):
    if thinking:
        temperature, top_p = 0.6, 0.95
    else:
        temperature, top_p = 0.7, 0.8
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "top_k": 20,
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        f"{api_url}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"]
            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
            return content
    except Exception as e:
        return f"API_ERROR: {e}"


def detect_model(api_url):
    try:
        req = urllib.request.Request(f"{api_url}/models")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            models = data.get("data", [])
            if models:
                return models[0]["id"]
    except Exception:
        pass
    return "qwen3-27b"


def clean_html(content):
    content = re.sub(r"^```html?\s*\n?", "", content)
    content = re.sub(r"\n?```\s*$", "", content)
    return content.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=11434)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=None)
    parser.add_argument("--thinking", action="store_true", default=True,
                        help="27B uses thinking mode by default")
    parser.add_argument("--no-thinking", dest="thinking", action="store_false")
    args = parser.parse_args()

    api_url = f"http://localhost:{args.port}/v1"
    model = detect_model(api_url)

    with open(PROMPTS_FILE) as f:
        all_prompts = json.load(f)

    end = args.start + (args.count or len(all_prompts) - args.start)
    prompts = all_prompts[args.start:end]

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    total = len(prompts)
    success = 0
    fail = 0
    start_time = time.time()

    print(f"=== Condition H: 27B Direct API (brief → implement) ===")
    print(f"Model: {model}")
    print(f"API: {api_url}")
    print(f"Thinking: {'ON (0.6/0.95)' if args.thinking else 'OFF (0.7/0.8)'}")
    print(f"Prompts: {args.start} to {args.start + total - 1} ({total} total)")
    print(f"Results: {RESULTS_DIR}")
    print()

    for i, p in enumerate(prompts):
        pid = p["id"]
        prompt_text = p["prompt"]
        n = args.start + i + 1
        t0 = time.time()

        out_dir = RESULTS_DIR / pid
        if (out_dir / "direct-output.html").exists():
            size = (out_dir / "direct-output.html").stat().st_size
            if size > 500:
                print(f"[{n}] {pid} — already done ({size} chars), skipping")
                success += 1
                continue

        print(f"=== [{n}/{args.start + total}] {pid} ===")
        out_dir.mkdir(parents=True, exist_ok=True)

        # Call 1: Brief
        brief_prompt = f"USER REQUEST: {prompt_text}\n\n{BRIEF_SYSTEM}"
        brief = call_api(api_url, model, brief_prompt, max_tokens=1024, thinking=args.thinking)
        if brief.startswith("API_ERROR"):
            print(f"  FAIL (brief): {brief[:100]}")
            fail += 1
            continue

        with open(out_dir / "brief.txt", "w") as f:
            f.write(brief)
        print(f"  Brief: {len(brief)} chars")

        # Call 2: Implement
        impl_prompt = IMPLEMENT_TEMPLATE.format(brief=brief)
        html = call_api(api_url, model, impl_prompt, max_tokens=16384, thinking=args.thinking)
        if html.startswith("API_ERROR"):
            print(f"  FAIL (implement): {html[:100]}")
            fail += 1
            continue

        html = clean_html(html)
        with open(out_dir / "direct-output.html", "w") as f:
            f.write(html)

        chars = len(html)
        has_body = "<body" in html.lower()
        elapsed = time.time() - t0
        status = "OK" if chars > 2000 and has_body else "PARTIAL"
        print(f"  {status}: {chars} chars, body={'Y' if has_body else 'N'}, {elapsed:.0f}s")

        if chars > 2000 and has_body:
            success += 1
        else:
            fail += 1
        print()

    elapsed_total = time.time() - start_time
    minutes = int(elapsed_total // 60)
    seconds = int(elapsed_total % 60)

    print(f"=== Batch complete: {success}/{total} succeeded, {fail} failed ({minutes}m {seconds}s) ===")

    summary = {
        "condition": "H",
        "model": model,
        "method": "direct API (brief + implement)",
        "thinking": args.thinking,
        "total": total,
        "success": success,
        "fail": fail,
        "elapsed_s": round(elapsed_total, 1),
        "start_index": args.start,
    }
    with open(RESULTS_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
