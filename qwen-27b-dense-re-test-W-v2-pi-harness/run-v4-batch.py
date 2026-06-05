#!/usr/bin/env python3
"""Run V4 raw-first harness on 12 benchmark prompts.

Outputs to condition-J-harness-v4/ matching condition-G/I structure.
V4 uses 3 LLM calls (generate + review + rework) vs V3's 5.
Expected ~8-12min per prompt vs V3's 20-30min.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from glob import glob
from pathlib import Path

WORKDIR = Path("/root/autodl-tmp/pi-harness-stable")
PROMPTS_FILE = WORKDIR / "prompts" / "all-100-prompts.json"
OUTPUT_DIR = WORKDIR / "condition-J-harness-v4"
WORKFLOW = "web-design-benchmark-v4"
ARTIFACT_PATTERN = "web-design-benchmark-v4-*"
TIMEOUT = 2100  # 35 min (generous for V4's 3 LLM calls)
MIN_TOKEN_REFS = 5

TEST_IDS = [
    "component-002-run0",
    "component-003-run0",
    "component-008-run0",
    "component-010-run0",
    "component-015-run0",
    "component-027-run0",
    "component-035-run0",
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
    pattern = str(WORKDIR / ".pi" / "workflow-artifacts" / ARTIFACT_PATTERN)
    dirs = sorted(glob(pattern), key=os.path.getmtime, reverse=True)
    for d in dirs:
        try:
            shutil.rmtree(d)
        except Exception:
            pass


def find_latest_artifact():
    pattern = str(WORKDIR / ".pi" / "workflow-artifacts" / ARTIFACT_PATTERN)
    dirs = sorted(glob(pattern), key=os.path.getmtime, reverse=True)
    return Path(dirs[0]) if dirs else None


def check_token_usage(html_path):
    text = html_path.read_text(errors="ignore")
    return text.count("var(--")


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    if (comp_dir / "harness-output.html").exists():
        size = (comp_dir / "harness-output.html").stat().st_size
        tokens = check_token_usage(comp_dir / "harness-output.html")
        if tokens >= MIN_TOKEN_REFS:
            print(f"  SKIP {comp_id}: already done ({size} bytes, {tokens} tokens)", flush=True)
            return True

    if comp_dir.exists():
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
            # Try to salvage output from artifact dir
            latest = find_latest_artifact()
            if latest and (latest / "index.html").exists():
                shutil.copy2(latest / "index.html", comp_dir / "harness-output.html")
                for f in latest.iterdir():
                    if f.is_file():
                        shutil.copy2(f, artifact_dir / f.name)
                size = (comp_dir / "harness-output.html").stat().st_size
                tokens = check_token_usage(comp_dir / "harness-output.html")
                if tokens >= MIN_TOKEN_REFS:
                    print(f"  SALVAGED {comp_id}: {size} bytes, {tokens} tokens (timeout but output complete)", flush=True)
                    return True
            return False
    except Exception as e:
        print(f"  ERROR: {e}", flush=True)
        return False

    elapsed = time.time() - start

    latest = find_latest_artifact()
    if not latest:
        print(f"  ERROR: no artifact dir found", flush=True)
        return False

    index_src = latest / "index.html"
    cwd_index = WORKDIR / "index.html"

    if index_src.exists():
        shutil.copy2(index_src, comp_dir / "harness-output.html")
    elif cwd_index.exists():
        shutil.copy2(cwd_index, comp_dir / "harness-output.html")
    else:
        print(f"  ERROR: no index.html found", flush=True)
        return False

    tokens = check_token_usage(comp_dir / "harness-output.html")
    if tokens < MIN_TOKEN_REFS:
        size = (comp_dir / "harness-output.html").stat().st_size
        print(f"  QUALITY FAIL: only {tokens} var(-- refs in {size} bytes", flush=True)
        return False

    for f in latest.iterdir():
        if f.is_file():
            shutil.copy2(f, artifact_dir / f.name)

    size = (comp_dir / "harness-output.html").stat().st_size
    svgs = (comp_dir / "harness-output.html").read_text(errors="ignore").count("<svg")
    hovers = (comp_dir / "harness-output.html").read_text(errors="ignore").count(":hover")
    artifacts = list(artifact_dir.iterdir())
    print(f"  OK {comp_id}: {size} bytes, {tokens} tokens, {svgs} SVGs, {hovers} hovers, {elapsed:.0f}s", flush=True)
    return True


def main():
    print(f"=== V4 Raw-First Harness Batch ({len(TEST_IDS)} prompts) ===", flush=True)
    print(f"Start: {time.strftime('%H:%M:%S')}", flush=True)
    print(f"Workflow: {WORKFLOW}", flush=True)
    print(f"Timeout: {TIMEOUT}s ({TIMEOUT//60}min)", flush=True)
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
            print(f"  ERROR: {comp_id} not in prompts file", flush=True)
            fail += 1
            continue

        if run_one(comp_id, prompt_map[comp_id]):
            ok += 1
        else:
            fail += 1

        print(flush=True)

    print(f"=== DONE: {ok} ok, {fail} failed ===", flush=True)
    print(f"End: {time.strftime('%H:%M:%S')}", flush=True)


if __name__ == "__main__":
    main()
