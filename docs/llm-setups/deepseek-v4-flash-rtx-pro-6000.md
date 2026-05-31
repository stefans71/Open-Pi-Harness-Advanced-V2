# DeepSeek V4 Flash on RTX PRO 6000 via ds4.c

Setup guide for running DeepSeek V4 Flash (284B MoE, q2-imatrix) on an NVIDIA RTX PRO 6000 Blackwell GPU using antirez's ds4.c server, integrated with the PI Agent harness.

**Important:** ds4-server is a **different binary** from llama-server. This guide uses [antirez's ds4.c project](https://github.com/antirez/ds4), not llama.cpp. The two are not interchangeable.

---

## Prerequisites

### Hardware Requirements

| Component | Required Spec |
|---|---|
| **GPU** | NVIDIA Blackwell (`sm_120`) with 96 GB VRAM |
| **CPU** | Multi-core x86_64 |
| **System RAM** | 96 GB+ |
| **Storage** | 180 GB+ for model weights + system |
| **GPU Driver** | 580.82.09+ |
| **CUDA** | 13.0+ |

### Software Requirements

| Software | Purpose |
|---|---|
| Git | Clone ds4 repository |
| Make + GCC/Clang | Compile ds4.c from source |
| NVIDIA CUDA Toolkit | GPU acceleration backend |
| Node.js 18+ | PI Agent harness runtime |
| npm or bun | Package management for PI extensions |

### Storage Note

The quantized model weights are **~81-85 GB**. Make sure you have sufficient disk space on whatever volume you plan to store them on. If you are on a cloud instance with separate system and data disks, the model must go on the data disk.

---

## Step 1: Clone and Compile ds4.c

```bash
cd /path/to/ds4/

git clone https://github.com/antirez/ds4.git
cd ds4

# Compile for Blackwell GPU architecture
make backend=cuda ARCH=sm_120
```

The `ARCH=sm_120` flag forces the compiler to optimize matrix calculations specifically for Blackwell's fifth-generation Tensor Cores, bypassing legacy compatibility overhead.

---

## Step 2: Download the Model Weights

**Only the q2-imatrix quantization from antirez's repository works with ds4.c.** Do NOT use Unsloth, standard Hugging Face, or other quantization formats -- they will fail to load.

```bash
./download_model.sh q2-imatrix
```

The script uses `curl -C -` under the hood. If your connection drops, re-running the command resumes where it left off.

After completion, the model file (`ds4flash.gguf`) will be in the project folder.

---

## Step 3: Start the ds4 Server

### Basic startup (32K context)
```bash
./ds4-server --ctx 32768 --host 0.0.0.0 --port 8000
```

### Recommended for agent workloads (210K context)
```bash
./ds4-server --ctx 210000 --host 127.0.0.1 --port 8000
```

### Maximum context (256K)
```bash
./ds4-server --ctx 262144 --host 127.0.0.1 --port 8000
```

### With vector steering enabled
```bash
./ds4-server --ctx 210000 --host 127.0.0.1 --port 8000 \
  --dir-steering-file /path/to/ds4/dir-steering/verbosity.f32 \
  --dir-steering-ffn -1 \
  --dir-steering-alpha 2.0
```

The server creates a local OpenAI-compatible API at `http://127.0.0.1:8000/v1`.

### VRAM Usage at Different Context Sizes

| Context Window | Approx. VRAM Usage | Fits in 96 GB? |
|---|---|---|
| 32K | ~83 GB | Yes (comfortable) |
| 65K | ~84 GB | Yes (comfortable) |
| 210K | ~88 GB | Yes |
| 256K | ~89 GB | Yes |
| 1M | ~96 GB | Tight (uses NVMe offload) |

DeepSeek V4 Flash's Compressed Sparse Attention (CSA) only consumes ~10% of the KV cache memory compared to dense models. Combined with ds4.c's on-disk KV state management, massive contexts are feasible.

---

## Step 4: Configure the PI Agent Harness

The PI Agent harness is fully compatible with ds4.c out of the box. Only configuration changes are needed -- no code modifications required (with one exception for pi-memory, see below).

### 4a. Update the Model Provider

ds4-server runs on port **8000**, not port 11434 (which is Ollama's default). Update the model provider config accordingly.

Edit `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "openai": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "apiKey": "ds4-local-token"
    }
  }
}
```

### 4b. Patch the pi-memory Hardcoded Endpoint

The `pi-memory` extension has a hardcoded generation URL that defaults to `localhost:11434` (the Ollama port). For ds4.c, this must point to port 8000.

**File:** `extensions/pi-memory/src/config.ts`

The `shared.generationUrl` value defaults to `http://localhost:11434`. Change it to `http://127.0.0.1:8000/v1`:

```typescript
// Change from:
export const BASE_URL = "http://localhost:11434";

// Change to:
export const BASE_URL = "http://127.0.0.1:8000/v1";
```

Alternatively, if your harness version supports config.json overrides for extension endpoints, use that to avoid modifying source code directly.

After saving, rebuild the extension:

```bash
npm run build
```

### 4c. Optimize Token Settings for 96 GB VRAM

Edit `~/.pi/agent/settings.json`:

| Setting | Old Value (Qwen 27B) | New Value (DeepSeek V4) | Why |
|---|---|---|---|
| `reserveTokens` | (default) | `32768` | More headroom for multi-step tool arrays |
| `keepRecentTokens` | (default) | `150000` | Keep massive history verbatim, skip lossy summarization |

DeepSeek V4 Flash handles large context efficiently. You can defer compaction much longer than with Qwen 3.6 27B.

---

## Step 5: PI Agent Harness Compatibility Spec

These are five critical integration points audited against the PI Agent codebase. All five pass without code changes.

### 1. `<think>` Tag Handling -- Natively Supported

PI Agent's OpenAI Completions provider explicitly detects reasoning content in multiple fields: `reasoning_content`, `reasoning`, `reasoning_text`. When found, it creates a separate `type: "thinking"` content block. The thinking output is preserved and separated from text output cleanly.

**You do NOT need the `--no-think` flag** when running with the PI Agent harness.

### 2. API Base URL -- Configurable

The endpoint is configured via `~/.pi/agent/models.json`, not hardcoded. API keys resolve in order: environment variable -> `auth.json` -> OAuth token.

**One exception:** The `pi-memory` extension hardcodes the generation URL in `extensions/pi-memory/src/config.ts` -- update this per Step 4b above.

### 3. Tool Calling -- Standard OpenAI API

The harness uses the standard OpenAI `tools: [...]` parameter in API requests and reads structured `tool_calls` from the response stream. It never regex-parses tool calls from text. DeepSeek V4's native OpenAI-compatible tool calling works directly.

### 4. Memory and Context -- Summarization-Based Compaction

When context exceeds `context_window - 16384` reserved tokens, the harness:
1. Keeps the ~20,000 most recent tokens verbatim
2. Summarizes everything older into a compaction block using the LLM itself
3. The `session_before_compact` hook fires first (this is where pi-memory extracts facts)

With 96 GB VRAM and DeepSeek's 256K context, the increased `reserveTokens` and `keepRecentTokens` values (Step 4c) defer compaction significantly.

### 5. Parallel Tool Execution -- Full Support

The agent loop collects ALL tool calls from a response, not just `tool_calls[0]`. It supports both parallel (`Promise.all` style) and sequential execution modes. Default is parallel unless a specific tool requires sequential execution.

DeepSeek V4 Flash firing multiple tool calls simultaneously works out of the box.

---

## Step 6: Launch PI Agent

With the ds4-server running and configuration updated:

```bash
cd /path/to/your/project
pi
```

Your agent will now execute against the DeepSeek V4 Flash backend at Blackwell speeds.

### Resuming Failed Workflows

```bash
/workflow run prd-to-code --resume latest
/workflow run prd-to-code --resume <run-id>
```

### Checking Workflow Artifacts

```bash
ls .pi/workflow-artifacts/
cat .pi/workflow-artifacts/<workflow-name>-<timestamp>/prd.md
```

---

## ds4 GUI and TUI Interfaces

ds4.c provides two interface modes. Use the TUI for direct terminal interaction, or run the headless API server for rich desktop GUIs.

### Option A: Interactive TUI (Terminal User Interface)

For direct, lightweight terminal chat without the PI Agent harness:

```bash
./ds4 --interactive
```

This launches a responsive multi-turn chat console with a `ds4>` prompt.

#### TUI Hot Commands

Type these directly during a conversation:

| Command | Effect |
|---|---|
| `/nothink` | Skip DeepSeek's reasoning phase for fast, direct answers |
| `/think-max` | Force maximum reasoning depth for hard problems |
| `/ctx 65536` | Dynamically resize the active context window |
| `/read path/to/file.py` | Inject a local file directly into VRAM context |

### Option B: Headless API Server + Desktop GUI

Run ds4 as a background API service and connect any OpenAI-compatible frontend:

```bash
./ds4-server --ctx 65536 --host 0.0.0.0 --port 8000
```

#### Compatible Desktop GUIs

| Application | Connection Method |
|---|---|
| **AnythingLLM** | OpenAI (Generic) provider |
| **Chatbox** | Custom OpenAI endpoint |
| **LM Studio** | OpenAI-compatible server |
| **Page Assist** | Custom API endpoint |
| **Continue.dev** | IDE extension with custom provider |

### AnythingLLM Setup

1. Open AnythingLLM and go to **Settings > LLM Provider**
2. Select **OpenAI (Generic)** from the dropdown
3. Set **Base URL** to: `http://127.0.0.1:8000/v1`
4. Set **API Key** to: `ds4` (any dummy text -- local server ignores it)
5. Set **Model Name** to: `deepseek-v4-flash`
6. Set **Token Context Window** to: `65536`
7. Click **Save Changes**

Note: AnythingLLM does NOT have GUI controls for vector steering. Steering is configured entirely at `ds4-server` startup via command-line flags and applies invisibly to all requests routed through the API.

### Continue.dev Setup

Add to `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "DeepSeek V4 Flash (ds4.c)",
      "provider": "openai",
      "model": "deepseek-v4-flash",
      "apiBase": "http://127.0.0.1:8000/v1",
      "apiKey": "not-needed-for-local"
    }
  ],
  "tabAutocompleteModel": {
    "title": "DeepSeek V4 Flash (ds4.c)",
    "provider": "openai",
    "model": "deepseek-v4-flash",
    "apiBase": "http://127.0.0.1:8000/v1"
  }
}
```

---

## Quick Reference: Server Startup Commands

| Use Case | Command |
|---|---|
| **Basic local server** | `./ds4-server --ctx 32768 --host 0.0.0.0 --port 8000` |
| **PI Agent (large context)** | `./ds4-server --ctx 210000 --host 127.0.0.1 --port 8000` |
| **Max context** | `./ds4-server --ctx 262144 --host 127.0.0.1 --port 8000` |
| **With steering** | `./ds4-server --ctx 65536 --host 0.0.0.0 --port 8000 --dir-steering-file ./dir-steering/verbosity.f32 --dir-steering-alpha 2.0` |
| **No thinking** | `./ds4-server --ctx 65536 --host 0.0.0.0 --port 8000 --no-think` |
| **Interactive TUI** | `./ds4 --interactive` |

---

## Troubleshooting

### Server won't start / OOM crash
- Reduce context: `--ctx 32768` uses the least VRAM
- Check NVIDIA driver: `nvidia-smi` should show your RTX PRO 6000 with 96 GB
- Verify the model file is on a volume with sufficient space (81-85 GB needed)

### PI Agent can't connect
- Confirm ds4-server is running: `curl http://127.0.0.1:8000/v1/models`
- Verify `~/.pi/agent/models.json` has `baseUrl: "http://127.0.0.1:8000/v1"`
- Check `pi-memory` config is updated from port 11434 to port 8000 (see Step 4b)

### Tool calls failing / JSON parse errors
- If your harness throws JSON errors, try adding `--no-think` to the server startup
- PI Agent should NOT need this (it handles `<think>` natively), but other harnesses might

### Model file won't load
- Only the `q2-imatrix` quantization from antirez's repository works with ds4.c
- Unsloth, standard HF, or other quantization formats will fail
- Re-run `./download_model.sh q2-imatrix` if the download was interrupted

---

## Architecture: How Everything Connects

```
+---------------------------------------------------------+
|                    Your Machine                         |
|                                                         |
|  +-------------+    +------------------------------+   |
|  |  PI Agent    |    |     ds4-server               |   |
|  |  Harness     |--->|  (port 8000)                 |   |
|  |  (TypeScript)|<---|                              |   |
|  |              |    |  +------------------------+  |   |
|  |  Extensions: |    |  |  DeepSeek V4 Flash     |  |   |
|  |  - pi-memory |    |  |  284B MoE (q2-imatrix) |  |   |
|  |  - pi-skills |    |  |  ~81 GB in VRAM        |  |   |
|  |  - pi-orch.  |    |  +------------------------+  |   |
|  |  - pi-workfl.|    |                              |   |
|  +-------------+    |  Optional:                    |   |
|                      |  - Vector Steering (.f32)     |   |
|  +-------------+    |  - KV Cache (NVMe offload)   |   |
|  | AnythingLLM  |--->|                              |   |
|  | / Chatbox    |<---|  RTX PRO 6000 (96 GB)       |   |
|  | / Continue   |    +------------------------------+   |
|  +-------------+                                        |
+---------------------------------------------------------+
```

**PI Agent** handles high-level logic: workflows, memory, skills, multi-agent orchestration.
**ds4-server** handles raw inference: token generation, tool-call parsing, vector steering.
**Desktop GUIs** (optional) provide visual chat interfaces via the same API endpoint.
