# Qwen 3.6-27B Dense MTP -- RTX 5090 (32 GB) Setup Guide

Running Qwen 3.6-27B Dense with Multi-Token Prediction on an RTX 5090 using optimized llama.cpp (llama-server).

---

## Hardware Requirements

| Component | Spec |
|---|---|
| **GPU** | NVIDIA RTX 5090 (32 GB VRAM) |
| **System RAM** | 32 GB minimum |

---

## Model

| Detail | Value |
|---|---|
| **Model** | Qwen 3.6-27B Dense |
| **Variant** | MTP (Multi-Token Prediction head baked in) |
| **GGUF File** | `Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` (~19.5 GB) |
| **Parameters** | 27B (all active -- dense, not MoE) |
| **Architecture** | Hybrid Gated DeltaNet + GQA (3:1 ratio, 64 layers) |
| **Context Window** | 131,072 tokens |
| **MTP Draft Layers** | 1 (15 tensors, built into weights) |

### Why 131K Context Fits in 32 GB

Qwen 3.6's hybrid architecture uses 75% Gated DeltaNet layers and 25% GQA layers. Only 16 out of 64 layers maintain a KV cache (the GQA layers). The other 48 layers use Gated DeltaNet with a fixed-size recurrent state that does not grow with context length. This is why the full 131K context window fits within 32 GB VRAM -- a standard transformer of this size would not.

### Fallback Quantization

If you hit OOM at long contexts with Q5, drop to Q4:

| Quant | File Size | VRAM (model only) |
|---|---|---|
| **Q5_K_XL (recommended)** | ~19.5 GB | ~19.5 GB |
| Q4_K_M (fallback) | ~16.8 GB | ~16.8 GB |

---

## VRAM Budget (131K Context)

| Component | Q5_K_XL | Q4_K_M |
|---|---|---|
| Model weights | ~19.5 GB | ~16.8 GB |
| KV cache (131K, quantized q8/q4) | ~4-6 GB | ~4-6 GB |
| MTP draft head overhead | ~0.5 GB | ~0.5 GB |
| Compute buffers | ~1-2 GB | ~1-2 GB |
| **Total** | **~25-28 GB** | **~22-25 GB** |
| **Headroom** | ~4-7 GB | ~7-10 GB |

---

## Optimized Server Command

```bash
/path/to/llama-server \
  -m /path/to/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --spec-type draft-mtp --spec-draft-n-max 3 \
  -ngl 99 --flash-attn on \
  -ctk q8_0 -ctv q4_0 \
  --ctx-size 131072 \
  --chat-template-kwargs '{"preserve_thinking":true}' \
  --host 0.0.0.0 --port 11434
```

> **Note:** `--cache-reuse 0` has been removed. On llama.cpp **b9310+** (May 25, 2026), the checkpoint system handles hybrid DeltaNet models properly. The `preserve_thinking` flag prevents prompt template drift that invalidates checkpoints. If you still experience multi-turn crashes, add `--cache-reuse 0` back as a safety fallback. See the [KV Cache Prefix Reuse](#kv-cache-prefix-reuse--checkpoint-status) section below for full details.

### What Each Flag Does

| Flag | Purpose | Impact |
|---|---|---|
| `--spec-type draft-mtp` | Activates MTP speculative decoding using the built-in draft head | **1.7-2.2x generation speed** |
| `--spec-draft-n-max 3` | Predict 3 tokens ahead per step | Optimal for quantized models (79-89% acceptance on code) |
| `-ngl 99` | Offload all layers to GPU | Full GPU acceleration |
| `--flash-attn on` | Memory-efficient attention kernel | Less VRAM for attention, faster prefill |
| `-ctk q8_0` | Quantize KV cache keys to 8-bit | Reduces KV cache VRAM |
| `-ctv q4_0` | Quantize KV cache values to 4-bit | Further KV reduction (+0.5% perplexity, negligible) |
| `--ctx-size 131072` | Set context window to 131K tokens | Matches model's practical limit on 32 GB |
| `--chat-template-kwargs '{"preserve_thinking":true}'` | Preserve thinking blocks across turns | **Critical** -- prevents prompt template drift that invalidates KV cache checkpoints |
| `--host 0.0.0.0` | Listen on all interfaces | Accessible from other machines/containers |
| `--port 11434` | Serve on port 11434 | Configurable to match your harness |

---

## Before vs. After

### Unoptimized Setup

```bash
/path/to/llama-server -m /path/to/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --port 11434 -ngl 99 --cache-reuse 0
```

- No MTP activation -- the draft head tensors sit unused in VRAM
- No flash attention -- higher VRAM usage for attention computation
- No KV cache quantization -- full precision KV eats into context headroom
- No context size set -- defaults to smaller window

### Optimized Setup

```bash
/path/to/llama-server \
  -m /path/to/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --spec-type draft-mtp --spec-draft-n-max 3 \
  -ngl 99 --flash-attn on \
  -ctk q8_0 -ctv q4_0 \
  --ctx-size 131072 \
  --chat-template-kwargs '{"preserve_thinking":true}' \
  --host 0.0.0.0 --port 11434
```

### Expected Performance

| Metric | Before (no MTP) | After (optimized) |
|---|---|---|
| **Generation speed** | ~50-60 tok/s | **~85-100 tok/s** |
| **Prefill speed** | ~300+ tok/s | ~250+ tok/s (slight MTP overhead on prefill) |
| **Context capacity** | Limited by unquantized KV | Full 131K tokens |
| **VRAM usage** | Higher (uncompressed KV) | Lower (quantized KV + flash-attn) |

### MTP Acceptance Rates by Task Type

| Task | Acceptance Rate | Effective Speedup |
|---|---|---|
| Code generation | 79-89% | **+47%** |
| Factual Q&A | 62-70% | +26% |
| Analysis | 48-56% | +12% |
| Creative writing | 39-48% | Minimal |

---

## Embedding Server (for pi-memory)

The `nomic-embed-text` server for pi-memory's vector search runs separately on CPU, requiring zero GPU VRAM:

```bash
/path/to/llama-server \
  -m /path/to/nomic-embed-text-v1.5.Q8_0.gguf \
  --port 8081 --embedding --ctx-size 2048 -ngl 0
```

This is lightweight (~140 MB) and does not compete for GPU VRAM. Any GGUF quant of nomic-embed-text-v1.5 works (Q4_K_M is sufficient; Q8_0 is overkill but small). The model produces 768-dimensional vectors.

Any OpenAI-compatible embedding endpoint can substitute -- pi-memory only needs an endpoint that accepts `/v1/embeddings` requests and returns 768-dim vectors.

---

## Start Script Example

A combined start script to launch both servers:

```bash
#!/bin/bash

# Qwen 3.6-27B Dense MTP -- Generation Server (GPU)
/path/to/llama-server \
  -m /path/to/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  --spec-type draft-mtp --spec-draft-n-max 3 \
  -ngl 99 --flash-attn on \
  -ctk q8_0 -ctv q4_0 \
  --ctx-size 131072 \
  --chat-template-kwargs '{"preserve_thinking":true}' \
  --host 0.0.0.0 --port 11434 &

# Nomic Embed -- Embeddings Server (CPU)
/path/to/llama-server \
  -m /path/to/nomic-embed-text-v1.5.Q8_0.gguf \
  --port 8081 --embedding --ctx-size 2048 -ngl 0 &

echo "Servers starting..."
echo "  Generation: http://0.0.0.0:11434 (Qwen 3.6-27B MTP)"
echo "  Embeddings: http://0.0.0.0:8081 (nomic-embed-text)"
wait
```

---

## Harness Configuration

### models.json

Point your harness at the llama-server generation endpoint using the `llama-server` provider format:

```json
{
  "providers": {
    "llama-server": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "sk-local",
      "model": "qwen-3.6-27b-mtp",
      "reasoning": true,
      "thinkingFormat": "qwen",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "streamable": true,
      "supportsTools": true,
      "supportsImages": false
    }
  }
}
```

| Field | Purpose |
|---|---|
| `baseUrl` | Points to the llama-server OpenAI-compatible endpoint |
| `apiKey` | Any non-empty string (llama-server does not enforce auth) |
| `model` | Display name / identifier for the model |
| `reasoning` | Enables extended thinking / chain-of-thought mode |
| `thinkingFormat` | `"qwen"` -- uses `<think>` / `</think>` block format |
| `contextWindow` | `131072` -- matches the `--ctx-size` flag on the server |
| `maxOutputTokens` | Maximum tokens for a single generation response |
| `streamable` | Enable streaming responses |
| `supportsTools` | Qwen 3.6 supports function/tool calling |
| `supportsImages` | Qwen 3.6-27B Dense is text-only (no vision) |

### settings.json

Consider increasing token settings to exploit the 131K context:

```json
{
  "reserveTokens": 32768,
  "keepRecentTokens": 80000
}
```

---

## KV Cache Prefix Reuse & Checkpoint Status

### The Problem

Qwen 3.6's hybrid architecture (75% Gated DeltaNet + 25% GQA) broke llama.cpp's KV cache prefix reuse. The DeltaNet layers maintain a recurrent state that cannot be partially rolled back like a standard KV cache. This caused the server to either crash or force **full prompt re-processing on every turn** -- re-computing the system prompt, tool definitions, and entire conversation history from scratch, even though most of it had not changed.

For agent workflows, this meant every request in a multi-step workflow redundantly re-processed the same ~2,000-4,000 token system prompt.

### What Has Been Fixed Upstream

| PR | Build | Date | Fix |
|---|---|---|---|
| [#22673](https://github.com/ggml-org/llama.cpp/pull/22673) | **b9180** | May 16, 2026 | MTP support added per-token snapshot support for recurrent/hybrid memory, enabling partial `seq_rm` |
| [#22929](https://github.com/ggml-org/llama.cpp/pull/22929) | **b9310** | May 25, 2026 | Fixed checkpoint creation -- extracts `message_spans` from chat templates, creates context checkpoint before the latest user message. Tested with Qwen 3.6-27B Q8_0 |

**Minimum recommended build: b9310+** (latest release as of May 30, 2026: **b9433**)

With b9310+, the checkpoint system handles the DeltaNet issue for the standard multi-turn case. The `preserve_thinking` template kwarg is critical -- without it, stripped thinking blocks cause prompt template drift that invalidates checkpoints.

### What Is Still Open

3 issues remain open where users still report full re-processing in edge cases:

| Issue | Description |
|---|---|
| [#22746](https://github.com/ggml-org/llama.cpp/issues/22746) | Qwen 3.6 27B forcing full prompt re-processing |
| [#23013](https://github.com/ggml-org/llama.cpp/issues/23013) | Forcing full prompt re-processing in Qwen 3.6 27B |
| [#23030](https://github.com/ggml-org/llama.cpp/issues/23030) | Prompt cache not reused for Qwen 3.6-35B-A3B |

### The Proposed Full Fix: PR #23814

**[PR #23814 -- "server: checkpoint before every user turn boundary"](https://github.com/ggml-org/llama.cpp/pull/23814)**

| Detail | Value |
|---|---|
| **Author** | reedmayhew18 (Reed Mayhew) |
| **Status** | Open (as of May 30, 2026) |
| **Base** | llama.cpp master (b9310+, includes #22929) |
| **Files changed** | `tools/server/server-context.cpp`, `tools/server/server-task.h` |
| **Changes** | +56 lines / -49 lines |

#### What it does

PR #22929 creates a checkpoint **only before the last user message**. This means if earlier turns change (e.g., thinking blocks stripped, tool results appended), all checkpoint cache hits are lost and the full prompt re-evaluates.

PR #23814 creates a checkpoint **before every user message** instead. The `prompt_get_n_before_user()` function becomes `prompt_get_user_boundaries()` -- the prefill batch breaks at each user turn boundary and a checkpoint is allowed at any of them, bounded by `--checkpoint-min-step` and `--ctx-checkpoints`.

#### The result

Tested on Qwen 3.6-27B with a 36K-token conversation:

| Metric | Before (master + #22929) | After (+ #23814) |
|---|---|---|
| Tokens re-evaluated per turn | ~full prompt (30s) | Only new tokens (~1s) |
| **Speedup** | -- | **~30x reduction in per-turn latency** |
| Cost model | O(N) per turn | **O(delta) per turn** |

#### Current review status

The PR is under active review by llama.cpp maintainer **ngxson**. Current feedback:
- The tokenizer-in-a-loop approach has O(N^2) complexity on large conversations
- reedmayhew18 is reworking it to O(N) as of May 30
- The core approach (checkpoint at every turn boundary) is sound but the implementation needs optimization

#### Originating commit

The fix originated from [commit 57f81cb](https://github.com/ggml-org/llama.cpp/commit/57f81cb13849de50a39e509e712d7c68e4f3e4b7) on reedmayhew18's fork, which includes additional patches beyond what is in the PR:

1. **Slot save/restore for hybrid models** -- handles the case where the recurrent backend rejects partial `seq_rm`
2. **LCP boundary backstep** -- rounds the post-LCP cut back to the nearest chat-template turn boundary
3. **Checkpoint rescue** -- uses the existing checkpoint infrastructure to restore state when rollback is rejected
4. **Forced checkpoint at every boundary token** -- ensures a usable rescue point always exists

### What to Do Now

**If on b9310+ (recommended):** use the optimized server command above without `--cache-reuse 0`.

**If multi-turn still crashes:** add `--cache-reuse 0` to the server command as a safety fallback (disables prefix caching entirely).

**For the full fix (build from reedmayhew18's fork):**

```bash
git clone https://github.com/reedmayhew18/llama.cpp.git llama-reed-fix
cd llama-reed-fix
git checkout master  # contains the fix commits
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="120"
cmake --build build --config Release -j$(nproc)
# Test with the optimized server command above using ./build/bin/llama-server
```

**Monitor PR #23814** -- once merged into mainline, rebuild from upstream master to get the fix without depending on the fork.

### Impact for Agent Workflows

With the fix working, each step in a multi-step agent workflow (e.g., a PRD-to-code pipeline with 8 LLM calls) would:
- **Before:** Re-process the full ~2,000-4,000 token system prompt + tool definitions + conversation history on every call (~30s overhead)
- **After:** Only process the new user message delta (~1s overhead)

Over an 8-step workflow, that is roughly **4 minutes saved** in redundant prefill alone.

---

## Building llama.cpp (Recommended: b9310+)

To get the checkpoint fixes for hybrid DeltaNet models:

```bash
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="120"
cmake --build build --config Release -j$(nproc)

# Verify version
./build/bin/llama-server --version
# Should show b9310 or later
```

Adjust `-DCMAKE_CUDA_ARCHITECTURES` for your GPU. RTX 5090 uses compute capability `120`. Other common values: `89` (RTX 4090), `86` (RTX 3090).

---

## Troubleshooting

### OOM at long contexts
- Drop to Q4_K_M: swap the model file to a Q4 variant
- Reduce context: `--ctx-size 65536` as a safe fallback
- Check nothing else is using GPU: `nvidia-smi`

### Multi-turn crashes
- First: ensure you are on llama.cpp **b9310+** and have `--chat-template-kwargs '{"preserve_thinking":true}'`
- If still crashing: add `--cache-reuse 0` as a safety fallback (disables prefix caching entirely)
- For the full fix: build from reedmayhew18's fork (see [KV Cache section](#kv-cache-prefix-reuse--checkpoint-status) above)
- Root cause: Qwen 3.6's Gated DeltaNet recurrent state cannot be partially rolled back like a standard KV cache

### Full prompt re-processing every turn
- Symptom: server logs show `prompt eval time = X ms / N tokens` where N equals the full prompt length, not just the new message
- Fix: upgrade to b9310+, enable `preserve_thinking`, and monitor PR #23814 for the complete fix

### MTP not activating
- Verify your GGUF file includes MTP tensors (filename should contain "MTP")
- Requires llama.cpp build **b9180 or later** -- older builds do not support `--spec-type draft-mtp`
- Check build version: `llama-server --version`

### Slow generation despite MTP
- MTP hurts at high concurrency (multiple simultaneous requests) -- GPU saturates and draft overhead dominates
- For single-request agent workflows, MTP is always beneficial
- Optimal draft count is 3 for quantized models -- going to 4+ drops acceptance rate sharply

---

## Quick Reference

| What | Value |
|---|---|
| **Model file** | `Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` (~19.5 GB) |
| **Minimum llama.cpp build** | **b9310** (for checkpoint fixes) |
| **Generation endpoint** | `http://127.0.0.1:11434/v1` |
| **Embeddings endpoint** | `http://127.0.0.1:8081` |
| **Context window** | 131,072 tokens |
| **Architecture** | Hybrid: 48 Gated DeltaNet + 16 GQA layers |
| **MTP speedup** | 1.7-2.2x on generation (code: +47%, Q&A: +26%) |

## Key Links

| Resource | URL |
|---|---|
| **PR #22929** (checkpoint fix, merged) | [github.com/ggml-org/llama.cpp/pull/22929](https://github.com/ggml-org/llama.cpp/pull/22929) |
| **PR #23814** (full turn-boundary fix, open) | [github.com/ggml-org/llama.cpp/pull/23814](https://github.com/ggml-org/llama.cpp/pull/23814) |
| **Issue #22746** (full re-processing bug) | [github.com/ggml-org/llama.cpp/issues/22746](https://github.com/ggml-org/llama.cpp/issues/22746) |
| **reedmayhew18's fork commit** | [57f81cb](https://github.com/ggml-org/llama.cpp/commit/57f81cb13849de50a39e509e712d7c68e4f3e4b7) |
| **llama.cpp releases** | [github.com/ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases) |
