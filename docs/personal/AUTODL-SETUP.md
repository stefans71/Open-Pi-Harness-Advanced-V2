# AutoDL Instance — Setup & Connection Handoff

> Last updated: 2026-05-31 (rewritten for Open-Pi-Harness-Advanced-V2)
> Written by Claude session that built and configured the llama-server MTP setup.
> Audience: a different Claude session working on the open-pi-harness codebase.

---

## 1. Current State

### Hardware

| Component | Value |
|---|---|
| GPU | NVIDIA GeForce RTX 5090 |
| VRAM | 32,607 MiB (32 GB) |
| Architecture | Blackwell (SM 12.0 / compute capability `sm_120a`) |
| CUDA Version | 13.0 (driver 580.142) |
| CUDA Toolkit | 12.8 (installed at `/usr/local/cuda`) |
| Platform | Linux x86_64, gcc 11.4, cmake 3.22 |
| Region | AutoDL westDC3 (西北B区), China mainland |

### What's Running

Two llama-server instances. Ollama has been fully removed.

**Generation server** (GPU, port 11434):
```
/root/autodl-tmp/llama-mtp/llama-server \
  -m /root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  -ngl 99 -c 131072 -fa on -np 1 \
  --spec-type draft-mtp --spec-draft-n-max 2 \
  --cache-reuse 0 \
  --host 0.0.0.0 --port 11434
```

**Embedding server** (CPU only, port 8081):
```
/root/autodl-tmp/llama-mtp/llama-server \
  -m /root/autodl-tmp/nomic-embed-text-v1.5.Q8_0.gguf \
  -ngl 0 --embedding \
  --host 0.0.0.0 --port 8081
```

### Loaded Models

| Field | Generation | Embeddings |
|---|---|---|
| Model | Qwen3.6-27B Dense MTP | nomic-embed-text-v1.5 |
| GGUF | `Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` (19 GB) | `nomic-embed-text-v1.5.Q8_0.gguf` (140 MB) |
| Device | GPU (RTX 5090, all 99 layers) | CPU only (`-ngl 0`) |
| Output | Text completions, tools, thinking | 768-dim float32 vectors |
| API | `/v1/chat/completions` | `/v1/embeddings` |
| Port | 11434 | 8081 |

### Port & API

| Port | Service | Protocol |
|---|---|---|
| **11434** | Generation (Qwen3.6-27B) | OpenAI-compatible (`/v1/chat/completions`, `/v1/completions`, `/health`) |
| **8081** | Embeddings (nomic-embed-text) | OpenAI-compatible (`/v1/embeddings`, `/health`) |

Both ports are forwarded through the VPS SSH tunnel (`-L 11434:localhost:11434 -L 8081:localhost:8081`).

### Performance (measured 2026-05-15)

| Metric | Value |
|---|---|
| Generation speed (MTP on) | **92–97 tok/s** (512-token generation) |
| Generation speed (baseline, no MTP) | ~55 tok/s |
| MTP speedup | ~1.8x |
| MTP acceptance rate | 78–80% |
| Prompt processing | ~83 tok/s |

### VRAM Usage by Context Size

| Context Window | VRAM Used | VRAM Free | Speed |
|---|---|---|---|
| 8K | 21,123 MiB (21.1 GB) | 11,484 MiB (11.5 GB) | 97.4 tok/s |
| 32K | 22,755 MiB (22.8 GB) | 9,852 MiB (9.8 GB) | — |
| 65K | 24,931 MiB (24.9 GB) | 7,676 MiB (7.7 GB) | — |
| 100K | 27,379 MiB (27.4 GB) | 5,228 MiB (5.2 GB) | 90.4 tok/s |
| **131K (current)** | **29,283 MiB (29.3 GB)** | **3,324 MiB (3.3 GB)** | **91.8 tok/s** |

131K is the maximum safe context window. Going higher risks OOM with only 3.3 GB headroom.

---

## 2. SSH Access

### From VPS to AutoDL

```bash
ssh -i /root/.ssh/id_ed25519 -p 33472 root@connect.westc.seetacloud.com
```

| Field | Value |
|---|---|
| Host | `connect.westc.seetacloud.com` |
| Port | `33472` (changes on every AutoDL reboot — check AutoDL web UI) |
| User | `root` |
| Auth | SSH key at `/root/.ssh/id_ed25519` (passwordless) |

The SSH key is already deployed to AutoDL's `authorized_keys`. No password needed.

**Important:** The SSH port changes every time AutoDL reboots. The current port is stored in `.autodl-port` at the repo root. If AutoDL reboots, update this file with the new port from the AutoDL web UI.

---

## 3. How PI Agent Connects

### Architecture

**Primary (AutoDL direct):** PI Agent runs directly on AutoDL, connecting to llama-server at `localhost:11434`. No tunnel needed. This is the production path.

**Legacy (VPS tunnel):** The VPS SSH tunnel still exists for Continue.dev (VS Code sidebar code completion on VPS). PI Agent does NOT use this tunnel.

**Development flow:** Code changes happen on VPS with Claude Code → sync to AutoDL via `scripts/sync-autodl.sh` → run PI on AutoDL.

### Connection Chain

```
VPS (HostDzire) — development only
  └→ scripts/sync-autodl.sh → rsync → AutoDL
  └→ SSH tunnel (for Continue.dev only, not PI Agent)

AutoDL RTX 5090 — execution
  ├→ llama-server (Qwen3.6-27B MTP, GPU, localhost:11434)
  ├→ llama-server (nomic-embed-text, CPU, localhost:8081)
  └→ PI Agent connects to both at localhost
```

### SSH Tunnel Service (VPS — for Continue.dev only)

File: `/etc/systemd/system/autodl-tunnel.service`

```ini
[Unit]
Description=SSH Tunnel to AutoDL Ollama
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -N -i /root/.ssh/id_ed25519 \
  -o StrictHostKeyChecking=no \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -L 11434:localhost:11434 \
  -L 8081:localhost:8081 \
  -p 33472 root@connect.westc.seetacloud.com
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Status: `systemctl status autodl-tunnel.service`
Restart: `systemctl restart autodl-tunnel.service`

The service description still says "Ollama" in its Description= field — cosmetic only. Both ports (11434 generation, 8081 embeddings) must be forwarded for pi-memory to function.

**Note on Node.js clients through the SSH tunnel:** Node.js `fetch()` and undici `Pool` fail with "other side closed" when connecting to port 8081 through the tunnel. The issue is HTTP keep-alive connection reuse — llama-server closes idle connections and the tunnel does not transparently reconnect. Use `undici.request()` (stateless, no persistent pool) instead. `curl` works because it sends `Connection: close` implicitly. See `extensions/pi-memory/src/embedding.ts` for the working implementation.

### PI Agent models.json

File: `/root/.pi/agent/models.json`

```json
{
    "providers": {
        "llama-server": {
            "baseUrl": "http://localhost:11434/v1",
            "apiKey": "none",
            "models": [
                {
                    "id": "qwen3.6-27b-mtp",
                    "name": "Qwen3.6-27B Dense MTP UD-Q5_K_XL 19GB",
                    "api": "openai-completions",
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 131072,
                    "maxTokens": 4096,
                    "compat": {
                        "thinkingFormat": "qwen",
                        "timeout": 7200000
                    },
                    "cost": {
                        "input": 0,
                        "output": 0,
                        "cacheRead": 0,
                        "cacheWrite": 0
                    }
                }
            ]
        }
    }
}
```

### Critical PI Config Fields

| Field | Value | Why |
|---|---|---|
| `baseUrl` | `http://localhost:11434/v1` | llama-server's OpenAI-compat endpoint, reached via SSH tunnel |
| `apiKey` | `"none"` | llama-server has no auth; PI requires a non-empty string |
| `api` | `"openai-completions"` | Tells PI to use OpenAI-compatible `/v1/chat/completions` format |
| `reasoning` | `true` | **Must be true** or PI's thinking toggle has no effect |
| `compat.thinkingFormat` | `"qwen"` | Tells PI to use `enable_thinking` parameter in requests. Without this, thinking control breaks silently. |
| `contextWindow` | `131072` | Max safe context on RTX 5090 with this model |

### API Format

llama-server speaks **OpenAI-compatible** API. Example request:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.6-27b-mtp",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 256
  }'
```

To disable thinking (skip `<think>` blocks):
```json
{"chat_template_kwargs": {"enable_thinking": false}}
```

To enable thinking (default when not specified):
```json
{"chat_template_kwargs": {"enable_thinking": true}}
```

The response includes a `timings` object with `predicted_per_second` (tok/s), `draft_n`, `draft_n_accepted` (MTP stats).

The response also includes `reasoning_content` in the message object when thinking is enabled, separate from `content`.

### Health Check

```bash
curl http://localhost:11434/health
# Returns: {"status":"ok"}
```

### Verify Connection from VPS

```bash
curl -s http://localhost:11434/health && echo " tunnel OK" || echo " tunnel DOWN"
```

---

## 4. What Was Built/Changed

### llama.cpp MTP Build

Built llama.cpp from the `mtp-clean` branch (MTP speculative decoding support, not yet in upstream llama.cpp).

| Detail | Value |
|---|---|
| Source | `am17an/llama.cpp` branch `mtp-clean` (GitHub, cloned via ghfast.top mirror) |
| Build location | `/root/autodl-tmp/llama-mtp/` (on AutoDL data disk) |
| Binary: llama-server | `/root/autodl-tmp/llama-mtp/llama-server` (71 MB) |
| Binary: llama-cli | `/root/autodl-tmp/llama-mtp/llama-cli` (70 MB) |
| Build dir | `/root/autodl-tmp/llama-mtp/build/` (~600 MB) |
| Build version | `b1-a957b77` |
| Compiler | gcc 11.4 |
| CUDA arch | SM_120 (auto-converted to `120a` by cmake for Blackwell) |

Build command used:
```bash
cd /root/autodl-tmp
git clone -b mtp-clean --depth 1 https://ghfast.top/https://github.com/am17an/llama.cpp.git llama-mtp
cmake llama-mtp -B llama-mtp/build \
  -DBUILD_SHARED_LIBS=OFF -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120
cmake --build llama-mtp/build --config Release -j$(nproc) \
  --target llama-cli llama-server
```

### Ollama Replacement

Ollama has been **fully removed**. It was replaced by llama-server because:
1. Ollama 0.21.2 does not support the `qwen3next` architecture (MTP variant of Qwen3.6)
2. Ollama attempted to load MTP GGUF and failed: "layer 64 missing attn_qkv/attn_gate projections"
3. llama-server from the MTP branch handles MTP speculative decoding natively

What was removed:
- Ollama process (killed)
- Ollama model blobs directory (`/root/autodl-tmp/ollama-models/` — deleted)
- MoE GGUF (`/root/autodl-tmp/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`, 21 GB — deleted to free space)

### Config Files Changed (on AutoDL)

| File | Change |
|---|---|
| `/root/autodl-tmp/start.sh` | Rewrote from Ollama startup to llama-server startup with MTP flags |

### MTP Speed Test Results

Measured on 2026-05-15, 512-token generation, thinking disabled:

| Context | Speed | MTP Accepted/Total | Acceptance Rate |
|---|---|---|---|
| 8K | 97.4 tok/s | 156/196 | 79.6% |
| 100K | 90.4 tok/s | 302/417 | 72.4% |
| 131K | 91.8 tok/s | 304/414 | 73.4% |

Baseline without MTP: ~55 tok/s. MTP provides ~1.8x speedup.

### GGUF Files on Disk

| File | Size | Status |
|---|---|---|
| `/root/autodl-tmp/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf` | 19 GB | Active — loaded by llama-server |
| `/root/autodl-tmp/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` | — | **Deleted** (was 21 GB MoE, freed disk space) |

---

## 5. Startup Sequence

### On AutoDL Reboot

AutoDL's system disk (`/root/`) resets on every reboot. The data disk (`/root/autodl-tmp/`) persists, so the model, build, and `start.sh` survive.

**Step 1:** SSH into AutoDL and start the servers:
```bash
bash /root/autodl-tmp/start.sh
```

This script:
1. Sets `CUDA_VISIBLE_DEVICES=0` and `LD_LIBRARY_PATH` (required for GPU inference)
2. Patches `~/.bashrc` with env vars (so interactive shells inherit them)
3. Kills any existing llama-server processes
4. Starts **generation** llama-server (GPU, port 11434) with MTP flags, logging to `/root/autodl-tmp/llama-server.log`
5. Starts **embedding** llama-server (CPU, port 8081) with nomic-embed-text, logging to `/root/autodl-tmp/embedding-server.log`
6. Waits up to 120 seconds for generation `/health` to return OK
7. Prints GPU info and health status

Generation model loads in ~6 seconds. Embedding server starts near-instantly (CPU only).

**Step 2:** Set up the PI Agent environment:
```bash
bash /root/autodl-tmp/setup-pi.sh
```

This idempotent script:
1. Adds Node.js to PATH (`/root/autodl-tmp/node-v22.15.0-linux-x64/bin`)
2. Installs PI Agent globally if missing (`npm install -g @mariozechner/pi-coding-agent`)
3. Writes `~/.pi/agent/settings.json` and `models.json` (correct config with `reasoning: true`, `thinkingFormat: "qwen"`)
4. Creates extension symlinks in `~/.pi/agent/extensions/` (pi-memory, pi-orchestrator, pi-skills, pi-workflows)
5. Copies `yaml` dependency into pi-workflows/node_modules/ (required for symlink resolution)
6. Runs smoke test (`pi -p "Reply with just: ok"`)

**Step 3:** Sync latest harness code from VPS:
```bash
# From VPS (using the sync script):
./scripts/sync-autodl.sh

# Or manually:
rsync -avz --exclude='node_modules' --exclude='.git' \
  /root/tinkering/Local-LLMs/Local-LLM-Agent/Open-Pi-Harness-Advanced-V2/ \
  -e "ssh -i /root/.ssh/id_ed25519 -p <PORT>" \
  root@connect.westc.seetacloud.com:/root/autodl-tmp/open-pi-harness/
```

The sync script (`scripts/sync-autodl.sh`) reads the SSH port from `.autodl-port` at the repo root. It excludes `node_modules`, `.git`, `tmp/`, `*.db`, `.pi/workflow-artifacts/`, and `.pi/skills/`. Supports `--check` (connectivity test) and `--bg` (background mode for git hooks).

**Step 4 (optional):** On VPS, restart the SSH tunnel for Continue.dev if the port changed:
```bash
# If port changed, edit /etc/systemd/system/autodl-tunnel.service first
sudo systemctl daemon-reload
sudo systemctl restart autodl-tunnel.service
```

### Verify Everything is Working

```bash
# 1. Generation tunnel
curl -s http://localhost:11434/health
# Expected: {"status":"ok"}

# 2. Embedding tunnel
curl -s http://localhost:8081/health
# Expected: {"status":"ok"}

# 3. Generation works
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-27b-mtp","messages":[{"role":"user","content":"Say hello"}],"max_tokens":32,"chat_template_kwargs":{"enable_thinking":false}}'

# 4. Embeddings work (should return 768 floats)
curl -s http://localhost:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input":"hello"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print("dim:", len(d["data"][0]["embedding"]))'
# Expected: dim: 768

# 5. Check VRAM on AutoDL
ssh -i /root/.ssh/id_ed25519 -p 33472 root@connect.westc.seetacloud.com \
  'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader'
# Expected: ~29283 MiB, 32607 MiB (embedding server adds ~0 VRAM — runs on CPU)
```

### Smoke Test Command (Quick)

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-27b-mtp","messages":[{"role":"user","content":"What is 2+2? One word."}],"max_tokens":16,"chat_template_kwargs":{"enable_thinking":false}}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"])'
```

---

## 6. Known Issues

### Build Issues Encountered (and Fixed)

1. **Missing web UI bundle files in shallow clone.**
   Shallow `git clone --depth 1` of the MTP branch didn't include `tools/server/public/bundle.js`, `bundle.css`, `index.html`, `loading.html`. The `xxd.cmake` script tried to embed them and failed with `file failed to open for reading` and `string sub-command LENGTH requires two arguments`.

   **Fix:** Created non-empty stub files:
   ```bash
   mkdir -p llama-mtp/tools/server/public
   echo '<!DOCTYPE html><html><body>stub</body></html>' > llama-mtp/tools/server/public/index.html
   echo '// stub' > llama-mtp/tools/server/public/bundle.js
   echo '/* stub */' > llama-mtp/tools/server/public/bundle.css
   echo '<!DOCTYPE html><html><body>loading</body></html>' > llama-mtp/tools/server/public/loading.html
   ```
   These stubs are still in place. The web UI at `http://localhost:11434` will show a blank stub page, but the API works fine.

2. **Wrong MTP flag name.**
   `--spec-type mtp` is invalid in this branch. The correct flag is `--spec-type draft-mtp`. Error message lists valid types: `none,draft-simple,draft-eagle3,draft-mtp,ngram-simple,...`

3. **Blackwell SM 12.0 compatibility.**
   RTX 5090 uses SM_120 (Blackwell). cmake auto-converts `-DCMAKE_CUDA_ARCHITECTURES=120` to `120a` (Blackwell-specific). This worked without issues. The CUDA toolkit 12.8 on AutoDL supports Blackwell natively.

4. **Multi-turn crash: LCP similarity partial-prefix rollback on hybrid DeltaNet recurrent state.**
   Without `--cache-reuse 0`, llama-server crashes on sequential requests that share a partial prompt prefix (e.g., PI Agent's `fresh_context` workflow sending phase 1 then phase 2). The prompt cache's LCP (Longest Common Prefix) matching attempts a partial rollback of the KV cache, but the hybrid Gated DeltaNet recurrent state can't be partially rolled back — it's all-or-nothing.

   **Fix:** Added `--cache-reuse 0` to the llama-server startup flags. This disables prompt cache prefix reuse entirely, so each request starts with a clean KV cache. No speed regression observed (91 tok/s with the flag vs 92-97 without — within measurement noise). The flag is now in `start.sh` on AutoDL.

### DFlash Speculative Decoding — Tested 2026-05-16, Not Adopted

Tested two DFlash approaches against the MTP baseline (91-97 tok/s). Neither was adopted. MTP remains production.

**Approach 1: vLLM + DFlash (z-lab method)**

vLLM 0.21.0 has DFlash built in (`SpeculativeConfig` supports `"method": "dflash"`). The drafter is `z-lab/Qwen3.6-27B-DFlash` — a 5-layer `DFlashDraftModel` (3.3 GB safetensors, NOT a standard Qwen3 architecture). Requires the full dense safetensors (~55 GB) as the target. Aborted before benchmarking — disk requirements (55 GB target + 10 GB vLLM + 3.3 GB drafter) were manageable on the expanded 250 GB disk, but the complexity vs. the MTP baseline wasn't worth it for the development phase.

Key findings:
- vLLM installs via Aliyun PyPI mirror at ~40 MB/s (fast)
- DFlash drafter (`z-lab/Qwen3.6-27B-DFlash`) is on ModelScope at ~15 MB/s
- The drafter's `DFlashDraftModel` architecture cannot be converted to GGUF with the current `convert_hf_to_gguf.py` (custom architecture, not standard Qwen3)
- No GGUF version of the drafter exists on ModelScope

**Approach 2: BeeLlama.cpp (llama.cpp fork with native DFlash + TurboQuant cache)**

Repo: `https://github.com/Anbeeld/beellama.cpp` — quickstart at `docs/quickstart-qwen36-dflash.md`

Requires:
- Plain dense target GGUF (`Qwen3.6-27B-Q5_K_S.gguf` from `unsloth/Qwen3.6-27B-GGUF`) — our MTP GGUF is incompatible
- DFlash drafter GGUF from `spiritbuun/Qwen3.6-27B-DFlash-GGUF` or `Ardenzard/Qwen3.6-27B-DFlash-GGUF` (HuggingFace, blocked from AutoDL — use hf-mirror.com)
- Custom cmake flags: `-DGGML_CUDA_FA=ON -DGGML_CUDA_FA_ALL_QUANTS=ON` (TurboQuant cache)
- New cache types: `turbo4` (K) and `turbo3_tcq` (V) — CUDA-only, compressed KV cache

Gate was >= 130 tok/s. Cancelled before building — prioritizing harness development over backend switching.

**If revisiting either approach:** MTP (91-97 tok/s) is stable and sufficient for development. Come back to DFlash only after the harness is solid. The BeeLlama.cpp path is more promising than vLLM for llama.cpp integration continuity.

### Network Issues (AutoDL is in China)

| Resource | Status | Workaround |
|---|---|---|
| GitHub (github.com) | Blocked — TLS handshake fails | Use `ghfast.top` mirror: `https://ghfast.top/https://github.com/...` for `git clone` only — API calls return empty |
| GitHub API (api.github.com) | Blocked via ghfast.top | Not usable — ghfast.top only proxies web/git, not REST API |
| HuggingFace (huggingface.co) | Blocked/throttled | Use ModelScope (modelscope.cn) OR `hf-mirror.com` (`HF_ENDPOINT=https://hf-mirror.com huggingface-cli download ...`) |
| Ollama registry (registry.ollama.ai) | Blocked | N/A — Ollama removed |
| AWS CloudFront | Blocked | N/A |
| ModelScope (modelscope.cn) | Works — ~35 MB/s downloads | Primary source for GGUFs |
| npm registry | Works via npmmirror | `npm config set registry https://registry.npmmirror.com` |
| Playwright CDN (cdn.playwright.dev) | ~55 KB/s — unusable | Download Chrome for Testing manually from npmmirror (see below) |
| Google Storage (storage.googleapis.com) | ~25 KB/s — unusable | Same as Playwright CDN — use npmmirror instead |

**Playwright browser install (manual):** `npx playwright install chromium` fails from China because cdn.playwright.dev and storage.googleapis.com are throttled to ~25-55 KB/s. The `PLAYWRIGHT_DOWNLOAD_HOST` mirror vars don't help — npmmirror has the Chrome for Testing binaries but under a different URL path than Playwright expects.

**Working approach:** Download Chrome for Testing manually via `aria2c` (multi-connection, ~1.3 MB/s) from npmmirror's Chrome for Testing mirror, then extract into the directory structure Playwright expects:

```bash
# Install aria2c for fast multi-connection download
apt-get install -y aria2 libarchive-tools

# Download Chrome for Testing + headless shell (Playwright 1.60.0 / chromium v1223)
export PW_CHROME_VER=148.0.7778.96
export PW_BROWSERS=/root/autodl-tmp/pw-browsers
mkdir -p $PW_BROWSERS

aria2c -x 16 -s 16 --max-connection-per-server=16 --file-allocation=none \
  "https://registry.npmmirror.com/-/binary/chrome-for-testing/${PW_CHROME_VER}/linux64/chrome-linux64.zip" \
  -d $PW_BROWSERS -o chrome-linux64.zip

aria2c -x 16 -s 16 --max-connection-per-server=16 --file-allocation=none \
  "https://registry.npmmirror.com/-/binary/chrome-for-testing/${PW_CHROME_VER}/linux64/chrome-headless-shell-linux64.zip" \
  -d $PW_BROWSERS -o chrome-headless-shell-linux64.zip

# Extract into Playwright's expected directory layout
# Use bsdtar, not unzip — the zip files are zip64 format
mkdir -p $PW_BROWSERS/chromium-1223
bsdtar -xf $PW_BROWSERS/chrome-linux64.zip -C /tmp && mv /tmp/chrome-linux64 $PW_BROWSERS/chromium-1223/chrome-linux/

mkdir -p $PW_BROWSERS/chromium_headless_shell-1223
bsdtar -xf $PW_BROWSERS/chrome-headless-shell-linux64.zip -C /tmp && mv /tmp/chrome-headless-shell-linux64 $PW_BROWSERS/chromium_headless_shell-1223/

# Clean up zips
rm -f $PW_BROWSERS/chrome-linux64.zip $PW_BROWSERS/chrome-headless-shell-linux64.zip
```

**Required env vars for Playwright scripts:**
```bash
export PATH="/root/autodl-tmp/bun/bin:/root/autodl-tmp/node-v22.15.0-linux-x64/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/root/autodl-tmp/pw-browsers
```

**To find the Chrome version for a different Playwright release:** Run `npx playwright install --dry-run` — it shows the exact Chrome version and revision number (e.g. `chromium v1223` -> directory suffix `-1223`).

### Temp Workarounds Still in Place

1. **Web UI stubs** — `tools/server/public/` contains stub HTML/JS/CSS files (see build issue #1 above). If you need the real web UI, do a full (non-shallow) clone and rebuild, or download the public files separately.

2. **Tunnel service description** — `/etc/systemd/system/autodl-tunnel.service` still says "SSH Tunnel to AutoDL Ollama" in its `Description=` field. Cosmetic only, does not affect function.

3. ~~**No embedding model**~~ — **Resolved.** A second llama-server instance runs `nomic-embed-text-v1.5.Q8_0.gguf` on CPU (port 8081). The SSH tunnel forwards both ports. pi-memory uses `undici.request()` to avoid the HTTP keep-alive issue described above.

### Other Limitations

- **131K max context** — VRAM usage at 131K is 29.3/32.6 GB (3.3 GB headroom). Do not set `contextWindow` higher.
- **Single slot** — llama-server runs with `-np 1` (one concurrent request). Parallel requests will queue, not run simultaneously. This is fine for single-user PI Agent use.
- **No vision** — The MTP GGUF does not include a vision encoder. `input: ["text"]` only.
- **SSH port changes on reboot** — AutoDL assigns a new SSH port every reboot. The user must check the AutoDL web UI and update `.autodl-port` in the repo root.

---

## 7. Files on AutoDL Data Disk

```
/root/autodl-tmp/
├── Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf   19G   Generation model GGUF (Qwen3.6-27B Dense MTP, UD-Q5_K_XL)
├── nomic-embed-text-v1.5.Q8_0.gguf    140M  Embedding model GGUF (nomic-embed-text-v1.5, Q8_0)
├── llama-mtp/                          693M  llama.cpp MTP branch (source + build + binaries)
│   ├── llama-server                    71M   The inference server binary (used for both servers)
│   ├── llama-cli                       70M   CLI inference binary
│   └── build/                          ~600M Build artifacts (cmake, object files, libs)
├── node-v22.15.0-linux-x64/           ~75M  Node.js binary (persists across reboots)
├── open-pi-harness/                   ~125M  PI extensions (rsynced from VPS)
├── start.sh                            2K    Startup script (launches both llama-server instances)
├── setup-pi.sh                         3K    PI Agent environment setup (idempotent, run after reboot)
├── llama-server.log                    4.2K  Generation server log (rotated on each start.sh run)
├── embedding-server.log                      Embedding server log (rotated on each start.sh run)
├── download.log                        34M   wget log from GGUF download (can be deleted)
├── Modelfile                           111B  Old Ollama Modelfile (orphaned, can be deleted)
└── pi-eval/                            56K   PI evaluation test scripts from earlier session
```

**Disk usage:** ~20 GB used / 250 GB total (230 GB free). Data disk was expanded to 250 GB on 2026-05-16.

**Safe to delete (frees ~34 MB):**
- `download.log` — wget output from the GGUF download
- `Modelfile` — old Ollama model definition, no longer used

---

## Quick Reference Card

```
GPU:            RTX 5090 (32 GB VRAM)
Server:         llama-server (llama.cpp mtp-clean branch, build b1-a957b77)
Model:          Qwen3.6-27B Dense MTP (UD-Q5_K_XL, 19 GB) — port 11434
Embeddings:     nomic-embed-text-v1.5 Q8_0 (140 MB, CPU only) — port 8081
Context:        131K tokens (max safe)
Speed:          92-97 tok/s with MTP
VRAM:           29.3 / 32.6 GB at 131K context (embedding server adds 0 VRAM)

SSH:            ssh -i /root/.ssh/id_ed25519 -p <PORT> root@connect.westc.seetacloud.com
Port file:      .autodl-port (repo root)
Health (gen):   curl localhost:11434/health
Health (embed): curl localhost:8081/health
API (gen):      POST localhost:11434/v1/chat/completions
API (embed):    POST localhost:8081/v1/embeddings
Logs:           /root/autodl-tmp/llama-server.log  (generation)
                /root/autodl-tmp/embedding-server.log  (embeddings)
Start servers:  bash /root/autodl-tmp/start.sh
Setup PI:       bash /root/autodl-tmp/setup-pi.sh
Sync code:      ./scripts/sync-autodl.sh
PI Agent:       cd /root/autodl-tmp/open-pi-harness && pi
```
