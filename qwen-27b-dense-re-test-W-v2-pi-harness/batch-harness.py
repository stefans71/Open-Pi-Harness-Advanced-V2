#!/usr/bin/env python3
"""
Condition G — Run prompts through web-design-benchmark workflow with Qwen3.6-27B.
8-node pipeline: brief → tokens → implement → verify → review → gate → rework → verify-rework.
Outputs: condition-G-harness/<component-id>/harness-output.html + artifacts/

Usage: python3 batch-harness.py [--port 11434] [--start 0] [--count 100]
  --start N   Resume from prompt N (0-indexed)
  --count N   Run N prompts (default: all remaining)
"""

import json
import os
import subprocess
import shutil
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
HARNESS_DIR = Path("/root/autodl-tmp/pi-harness-stable")

# Prompts: check multiple locations (VPS layout vs AutoDL flat copy)
_PROMPT_CANDIDATES = [
    SCRIPT_DIR / "prompts" / "all-100-prompts.json",
    Path("/root/autodl-tmp/all-100-prompts.json"),
    SCRIPT_DIR / "all-100-prompts.json",
]
PROMPTS_FILE = next((p for p in _PROMPT_CANDIDATES if p.exists()), _PROMPT_CANDIDATES[0])

# Results: write next to script if on VPS, or to /root/autodl-tmp/batch-results on AutoDL
RESULTS_DIR = SCRIPT_DIR / "condition-G-harness"
if not RESULTS_DIR.parent.exists():
    RESULTS_DIR = Path("/root/autodl-tmp/batch-results/27b-harness")

NODE_BIN = "/root/autodl-tmp/node-v22.15.0-linux-x64/bin"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=11434)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=None)
    parser.add_argument("--model", type=str, default="qwen3.6-27b-mtp")
    args = parser.parse_args()

    env = os.environ.copy()
    env["PATH"] = f"{NODE_BIN}:{env['PATH']}"

    with open(PROMPTS_FILE) as f:
        all_prompts = json.load(f)

    end = args.start + (args.count or len(all_prompts) - args.start)
    prompts = all_prompts[args.start:end]

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    total = len(prompts)
    success = 0
    fail = 0

    print(f"=== Condition G: 27B + web-design-benchmark (8-node) ===")
    print(f"Prompts: {args.start} to {args.start + total - 1} ({total} total)")
    print(f"Model: {args.model}")
    print(f"Harness: {HARNESS_DIR}")
    print(f"Results: {RESULTS_DIR}")
    print()

    for i, p in enumerate(prompts):
        pid = p["id"]
        prompt = p["prompt"]
        n = args.start + i + 1

        result_dir = RESULTS_DIR / pid
        if (result_dir / "harness-output.html").exists():
            size = (result_dir / "harness-output.html").stat().st_size
            if size > 500:
                print(f"[{n}/{args.start + total}] {pid} — already done ({size} chars), skipping")
                success += 1
                continue

        print(f"\n=== [{n}/{args.start + total}] {pid} ===")
        t0 = time.time()
        print(f"Start: {datetime.now().strftime('%H:%M:%S')}")

        # Clean previous index.html and stale workflow artifacts
        index_html = HARNESS_DIR / "index.html"
        if index_html.exists():
            index_html.unlink()
        artifacts_dir = HARNESS_DIR / ".pi" / "workflow-artifacts"
        if artifacts_dir.exists():
            for old in artifacts_dir.iterdir():
                if old.name.startswith("web-design-benchmark-"):
                    shutil.rmtree(old, ignore_errors=True)

        cmd_input = f"/workflow run web-design-benchmark {prompt}"
        try:
            result = subprocess.run(
                ["pi", "--model", args.model, "-p", cmd_input],
                cwd=str(HARNESS_DIR),
                env=env,
                capture_output=True,
                text=True,
                timeout=900,  # 15 min — 8-node pipeline averages ~9 min on 27B
            )
        except subprocess.TimeoutExpired:
            elapsed = time.time() - t0
            print(f"  TIMEOUT for {pid} ({int(elapsed)}s)")
            fail += 1
            continue

        result_dir.mkdir(parents=True, exist_ok=True)

        # Save workflow artifacts
        runs = []
        if artifacts_dir.exists():
            runs = sorted(
                [d for d in artifacts_dir.iterdir() if d.name.startswith("web-design-benchmark-")],
                key=lambda d: d.stat().st_mtime,
                reverse=True,
            )
            if runs:
                dest = result_dir / "artifacts"
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.copytree(runs[0], dest)

        # Collect index.html — check artifacts first, then cwd
        collected = False

        # Check artifacts dir
        if runs:
            candidate = runs[0] / "index.html"
            if candidate.exists() and candidate.stat().st_size > 500:
                shutil.copy2(candidate, result_dir / "harness-output.html")
                chars = candidate.stat().st_size
                print(f"  OK (artifacts): {chars} chars")
                success += 1
                collected = True

        # Check cwd
        if not collected and index_html.exists() and index_html.stat().st_size > 500:
            shutil.copy2(index_html, result_dir / "harness-output.html")
            chars = index_html.stat().st_size
            print(f"  OK (cwd): {chars} chars")
            success += 1
            collected = True

        if not collected:
            print(f"  FAIL: No index.html for {pid}")
            fail += 1

        elapsed = time.time() - t0
        print(f"  End: {datetime.now().strftime('%H:%M:%S')} ({int(elapsed)}s)")

    print(f"\n=== Batch complete: {success}/{total} succeeded, {fail} failed ===")

    # Save summary
    summary = {
        "condition": "G",
        "model": args.model,
        "method": "web-design-benchmark (8-node pipeline)",
        "total": total,
        "success": success,
        "fail": fail,
        "start_index": args.start,
    }
    with open(RESULTS_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
