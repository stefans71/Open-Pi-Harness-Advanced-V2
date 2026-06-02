# 27B Harness Benchmark Test

## Quick Context

This directory runs 100 frontend component prompts through an 8-node Pi harness workflow
on Qwen3.6-27B, then compares GPT-5.4 critique scores against the V1 baseline (raw 27B
without harness, avg 5.81/10).

Read `README.md` in this directory for full details: database queries, AutoDL setup,
scoring pipeline, known issues.

## Key Facts

- **Workflow:** `web-design-benchmark.yaml` (8 nodes: brief → tokens → implement → verify → review → gate → rework → verify-rework)
- **Workflow location:** `/.pi/workflows/web-design-benchmark.yaml` (relative to harness root `pi-harness-stable/`)
- **Batch script:** `batch-harness.py` — runs prompts via `pi -p "/workflow run web-design-benchmark <prompt>"`
- **Timeout:** 15 min per prompt, ~9 min average
- **Output:** `condition-G-harness/<component-id>/harness-output.html` + `artifacts/`

## Baseline Data

V1 dataset SQLite DB:
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/db/dataset.sqlite
```

Two scoring systems exist in this DB — don't confuse them:
- **Critique scores** (in `components.critique_text`, /10 scale) = GPT-5.4 reviewing the **raw 27B output**. This is our baseline: **5.81/10 avg**.
- **Eval scores** (in `eval_scores` table, /9 scale) = scoring the **GPT-5.4 improved output**. This is the ceiling, not the baseline.

V1 raw component files:
```
/root/tinkering/Local-LLMs/Local-LLM-Agent/frontend-design-dataset/output/assets/components/component-NNN-run0/
```

## AutoDL Instance

- SSH: `ssh -p <PORT> root@connect.westc.seetacloud.com` (port changes on reboot)
- GPU: RTX 5090, 32GB VRAM
- Model: `/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf`
- Pi harness: `/root/autodl-tmp/pi-harness-stable/`
- llama-server: `llama-mtp/build/bin/llama-server` on port 11434
- models.json model ID: `qwen3.6-27b-mtp`

## Branch

Work is on `feat/27b-harness-batch` branch of the `pi-harness-stable` repo.

## What NOT to Touch

- `batch-direct.py` and `condition-H-direct/` exist but are not used — the V1 raw output already serves as the no-harness baseline.
- The full 24-node `web-design.yaml` is for real project work, not this benchmark. Use `web-design-benchmark.yaml`.
- Don't modify the parent `pi-harness-stable/CLAUDE.md` — it covers the harness project itself.

## Pipeline Status

After batch completes on AutoDL:
1. Rsync `condition-G-harness/` back to VPS
2. Screenshot each `harness-output.html` with Playwright (1280x900)
3. Score screenshots with GPT-5.4 using same /10 critique rubric as V1
4. Compare against V1 critique scores (5.81/10 avg, 91 of 100 run0 prompts scored)
