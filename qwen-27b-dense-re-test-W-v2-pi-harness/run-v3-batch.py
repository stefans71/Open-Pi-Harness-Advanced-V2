#!/usr/bin/env python3
"""Run V3 dictionary harness on 12 benchmark prompts.

Outputs to condition-I-harness-v3/ matching condition-G-harness/ structure.
Uses os.setsid() + os.killpg() for proper process group management.
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
OUTPUT_DIR = WORKDIR / "condition-I-harness-v3"
WORKFLOW = "web-design-benchmark-dict"
TIMEOUT = 1500  # 25 min per prompt

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
            print(f"  Killing stale pi: {result.stdout.strip()}", flush=True)
            subprocess.run(["pkill", "-f", "pi "], capture_output=True)
            time.sleep(3)
    except Exception:
        pass


def find_latest_artifact():
    pattern = str(WORKDIR / ".pi" / "workflow-artifacts" / f"{WORKFLOW}-*")
    dirs = sorted(glob(pattern), key=os.path.getmtime, reverse=True)
    return Path(dirs[0]) if dirs else None


def run_one(comp_id, prompt_text):
    comp_dir = OUTPUT_DIR / comp_id
    artifact_dir = comp_dir / "artifacts"

    if (comp_dir / "harness-output.html").exists():
        size = (comp_dir / "harness-output.html").stat().st_size
        print(f"  SKIP {comp_id}: already done ({size} bytes)", flush=True)
        return True

    comp_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    kill_stale_pi()

    cmd = f'pi -p "/workflow run {WORKFLOW} {prompt_text}"'
    env = os.environ.copy()
    env["PATH"] = PATH

    print(f"  Running pi...", flush=True)
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

    # Copy all artifacts
    for f in latest.iterdir():
        if f.is_file():
            shutil.copy2(f, artifact_dir / f.name)

    size = (comp_dir / "harness-output.html").stat().st_size
    artifacts = list(artifact_dir.iterdir())
    print(f"  OK {comp_id}: {size} bytes, {len(artifacts)} artifacts, {elapsed:.0f}s", flush=True)
    return True


def main():
    print(f"=== V3 Dict Harness Batch ({len(TEST_IDS)} prompts) ===", flush=True)
    print(f"Start: {time.strftime('%H:%M:%S')}", flush=True)
    print(f"Workflow: {WORKFLOW}", flush=True)
    print(f"Output: {OUTPUT_DIR}", flush=True)
    print(flush=True)

    with open(PROMPTS_FILE) as f:
        all_prompts = json.load(f)

    prompt_map = {p["id"]: p["prompt"] for p in all_prompts}

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ok = 0
    fail = 0

    for i, comp_id in enumerate(TEST_IDS, 1):
        print(f"[{i}/{len(TEST_IDS)}] {time.strftime('%H:%M:%S')} START {comp_id}", flush=True)

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
