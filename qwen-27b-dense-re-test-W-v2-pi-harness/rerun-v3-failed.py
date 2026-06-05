#!/usr/bin/env python3
"""Re-run failed/bad V3 dictionary harness components.

Fixes over run-v3-batch.py:
  1. Artifact lookup validates brief matches current prompt (prevents cross-contamination)
  2. 35min timeout (was 25min — some V2 runs took 30+ min legitimately)
  3. Post-run quality gate: rejects output with 0 var(-- refs (003 had this bug)
  4. Cleans stale workflow artifact dirs before each run (prevents stale pickup)

Re-run list: 003 (zero tokens), 010 (timeout), 015 (timeout), 027 (contaminated)
"""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from glob import glob
from pathlib import Path

WORKDIR = Path("/root/autodl-tmp/pi-harness-stable")
PROMPTS_FILE = WORKDIR / "prompts" / "all-100-prompts.json"
OUTPUT_DIR = WORKDIR / "condition-I-harness-v3"
WORKFLOW = "web-design-benchmark-dict"
ARTIFACT_PATTERN = "web-design-benchmark-dict-*"
TIMEOUT = 2100  # 35 min
MIN_TOKEN_REFS = 5  # minimum var(-- references to accept output

RERUN_IDS = [
    "component-003-run0",
    "component-010-run0",
    "component-015-run0",
    "component-027-run0",
    "component-040-run0",
    "component-043-run0",
    "component-044-run0",
    "component-052-run0",
    "component-059-run0",
]

PATH = "/root/autodl-tmp/node-v22.15.0-linux-x64/bin:/root/autodl-tmp/bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def kill_stale_pi():
    try:
        result = subprocess.run(["pgrep", "-a", "pi"], capture_output=True, text=True)
        if result.stdout.strip():
            for line in result.stdout.strip().split("\n"):
                if "pi " in line or "pi\n" in line:
                    print(f"  Killing stale pi: {line.strip()}", flush=True)
            subprocess.run(["pkill", "-f", "pi "], capture_output=True)
            time.sleep(3)
    except Exception:
        pass


def clean_stale_artifacts():
    """Remove old workflow artifact dirs to prevent stale pickup."""
    pattern = str(WORKDIR / ".pi" / "workflow-artifacts" / ARTIFACT_PATTERN)
    dirs = sorted(glob(pattern), key=os.path.getmtime, reverse=True)
    for d in dirs:
        try:
            shutil.rmtree(d)
            print(f"  Cleaned stale artifact: {Path(d).name}", flush=True)
        except Exception as e:
            print(f"  WARN: couldn't clean {d}: {e}", flush=True)


def find_latest_artifact():
    pattern = str(WORKDIR / ".pi" / "workflow-artifacts" / ARTIFACT_PATTERN)
    dirs = sorted(glob(pattern), key=os.path.getmtime, reverse=True)
    return Path(dirs[0]) if dirs else None


def validate_artifact(artifact_dir, comp_id, prompt_text):
    """Check that the artifact actually belongs to this prompt."""
    brief = artifact_dir / "brief.md"
    if not brief.exists():
        print(f"  WARN: no brief.md in artifact dir", flush=True)
        return True  # can't validate, assume OK

    brief_text = brief.read_text(errors="ignore")[:2000].lower()

    # Extract key words from prompt to match against brief
    prompt_words = set(re.findall(r'\b[a-z]{4,}\b', prompt_text.lower()))
    brief_words = set(re.findall(r'\b[a-z]{4,}\b', brief_text))

    # At least 3 distinctive prompt words should appear in brief
    overlap = prompt_words & brief_words
    common = {"that", "this", "with", "from", "have", "your", "will", "should",
              "make", "each", "when", "them", "into", "more", "only", "also",
              "than", "been", "like", "some", "what", "about", "just", "over",
              "such", "most", "very", "then", "after", "well", "back", "even",
              "good", "much", "because", "between", "under", "both", "through",
              "before", "first", "where", "right", "look", "think", "still",
              "design", "component", "style", "color", "button", "text", "background",
              "section", "show", "dark", "white", "blue", "font", "icon", "layout",
              "html", "inline", "external", "libraries", "self", "contained"}
    distinctive = overlap - common

    if len(distinctive) < 3:
        print(f"  CONTAMINATED: brief has only {len(distinctive)} matching words: {distinctive}", flush=True)
        return False

    return True


def check_token_usage(html_path):
    """Check that output actually uses design tokens."""
    text = html_path.read_text(errors="ignore")
    token_refs = text.count("var(--")
    return token_refs


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    # Remove previous bad output
    if comp_dir.exists():
        print(f"  Removing previous bad output for {comp_id}", flush=True)
        shutil.rmtree(comp_dir)

    comp_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    kill_stale_pi()
    clean_stale_artifacts()

    cmd = f'pi -p "/workflow run {WORKFLOW} {prompt_text}"'
    env = os.environ.copy()
    env["PATH"] = PATH

    print(f"  Running pi (timeout={TIMEOUT}s)...", flush=True)
    start = time.time()

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
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            proc.wait()
            print(f"  TIMEOUT after {TIMEOUT}s", flush=True)
            return False
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)
        return False

    elapsed = time.time() - start

    latest = find_latest_artifact()
    if not latest:
        print(f"  ERROR: no artifact dir found", flush=True)
        return False

    # Validate artifact belongs to this prompt (prevents cross-contamination)
    if not validate_artifact(latest, comp_id, prompt_text):
        print(f"  REJECTED: artifact doesn't match prompt for {comp_id}", flush=True)
        return False

    # Copy index.html -> harness-output.html
    index_src = latest / "index.html"
    cwd_index = WORKDIR / "index.html"

    if index_src.exists():
        shutil.copy2(index_src, comp_dir / "harness-output.html")
    elif cwd_index.exists():
        shutil.copy2(cwd_index, comp_dir / "harness-output.html")
    else:
        print(f"  ERROR: no index.html found", flush=True)
        return False

    # Check token usage (catches the 003 zero-token bug)
    token_refs = check_token_usage(comp_dir / "harness-output.html")
    if token_refs < MIN_TOKEN_REFS:
        size = (comp_dir / "harness-output.html").stat().st_size
        print(f"  QUALITY FAIL: only {token_refs} var(-- refs in {size} bytes — rejecting", flush=True)
        # Keep the output for inspection but mark it
        (comp_dir / "QUALITY_FAIL.txt").write_text(
            f"Only {token_refs} var(-- references. Minimum is {MIN_TOKEN_REFS}.\n"
            f"File size: {size} bytes. Elapsed: {elapsed:.0f}s.\n"
            f"This output did not use the design token system.\n"
        )
        return False

    # Copy all artifacts
    for f in latest.iterdir():
        if f.is_file():
            shutil.copy2(f, artifact_dir / f.name)

    size = (comp_dir / "harness-output.html").stat().st_size
    artifacts = list(artifact_dir.iterdir())
    print(f"  OK {comp_id}: {size} bytes, {len(artifacts)} artifacts, {token_refs} token refs, {elapsed:.0f}s", flush=True)
    return True


def main():
    print(f"=== V3 Dict Harness RERUN ({len(RERUN_IDS)} failed components) ===", flush=True)
    print(f"Start: {time.strftime('%H:%M:%S')}", flush=True)
    print(f"Workflow: {WORKFLOW}", flush=True)
    print(f"Timeout: {TIMEOUT}s ({TIMEOUT//60}min)", flush=True)
    print(f"Min token refs: {MIN_TOKEN_REFS}", flush=True)
    print(f"Output: {OUTPUT_DIR}", flush=True)
    print(flush=True)

    with open(PROMPTS_FILE) as f:
        all_prompts = json.load(f)

    prompt_map = {p["id"]: p["prompt"] for p in all_prompts}

    ok = 0
    fail = 0

    for i, comp_id in enumerate(RERUN_IDS, 1):
        print(f"[{i}/{len(RERUN_IDS)}] {time.strftime('%H:%M:%S')} RERUN {comp_id}", flush=True)

        if comp_id not in prompt_map:
            print(f"  ERROR: {comp_id} not in prompts file", flush=True)
            fail += 1
            continue

        if run_one(comp_id, prompt_map[comp_id]):
            ok += 1
        else:
            fail += 1

        print(flush=True)

    print(f"=== RERUN DONE: {ok} ok, {fail} failed ===", flush=True)
    print(f"End: {time.strftime('%H:%M:%S')}", flush=True)


if __name__ == "__main__":
    main()
