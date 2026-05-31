# Qwen 3.5 VL -- Fine-Tuned Web Design Models

> Two fine-tuned vision-language models for frontend web design, built on Qwen 3.5 VL.
> Created by [stefans71](https://huggingface.co/stefans71).

---

## Overview

The pi-skills `web-design` skill and the pi-workflows `web-design` workflow implement a structured frontend design pipeline: Intent First, Token System, Inventory, Build, Verify, Review, Gate. Each phase produces artifacts that feed the next.

A standard text-only model (e.g., Qwen 3.6 27B) handles these phases well, but a vision-language model adds a capability that text models lack: **understanding screenshots**. A VL model can analyze reference designs, compare rendered output against the brief, and evaluate visual hierarchy, spacing, and color usage from actual pixels rather than guessing from code alone.

These two fine-tuned models specialize Qwen 3.5 VL for exactly this task. Fine-tuning on frontend design data improves HTML/CSS/JS generation quality and screenshot comprehension compared to the base VL models, particularly for the Build and Review phases where the model needs to reason about both code and visual output.

---

## Model Comparison

| | **frontend-design-expert-8b** | **frontend-design-lite-4b** |
|---|---|---|
| HuggingFace | [stefans71/frontend-design-expert-8b](https://huggingface.co/stefans71/frontend-design-expert-8b) | [stefans71/frontend-design-lite-4b](https://huggingface.co/stefans71/frontend-design-lite-4b) |
| Base model | Qwen 3.5 VL 8B | Qwen 3.5 VL 4B |
| Model type | Vision-language (multimodal) | Vision-language (multimodal) |
| Task | Frontend web design: HTML/CSS/JS generation from design screenshots and descriptions | Same |
| Recommended quant | Q4_K_M | Q4_K_M |
| Quant size | 4.7 GB | 2.4 GB |
| VRAM required | 12 GB | 8 GB |
| Compatible GPUs | RTX 3060 12GB, RTX 4070, Apple M2 | RTX 3060 8GB, Apple M1 |
| Qualifying score | 10/10 | 9/10 |
| Delta vs base | +1.0/10 | ~0 (similar to base) |
| Training loss | 0.246 | 0.325 |
| Recommendation | **Use this one** for quality | Use when VRAM is constrained |

The 8B Expert is the recommended choice. It shows a meaningful quality improvement over the base model (+1.0/10 delta, lower training loss). The 4B Lite scores well but does not significantly outperform its base, making it primarily useful on hardware that cannot fit the 8B variant.

---

## Download

### Using huggingface-cli

Install the CLI if needed:

```bash
pip install huggingface_hub[cli]
```

Download the 8B Expert:

```bash
huggingface-cli download stefans71/frontend-design-expert-8b \
  --local-dir ./models/frontend-design-expert-8b
```

Download the 4B Lite:

```bash
huggingface-cli download stefans71/frontend-design-lite-4b \
  --local-dir ./models/frontend-design-lite-4b
```

### GGUF Conversion

If the HuggingFace repo provides safetensors weights rather than pre-built GGUF files, convert them using llama.cpp's conversion script:

```bash
# Clone llama.cpp if you don't have it
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp

# Convert to GGUF (fp16 intermediate)
python convert_hf_to_gguf.py ../models/frontend-design-expert-8b \
  --outfile ../models/frontend-design-expert-8b-f16.gguf

# Quantize to Q4_K_M
./llama-quantize ../models/frontend-design-expert-8b-f16.gguf \
  ../models/frontend-design-expert-8b-Q4_K_M.gguf Q4_K_M
```

If pre-quantized GGUF files are available in the HuggingFace repo, download those directly instead:

```bash
huggingface-cli download stefans71/frontend-design-expert-8b \
  --include "*.gguf" \
  --local-dir ./models/frontend-design-expert-8b
```

---

## llama-server Setup

### Running a VL Model

Vision-language models in GGUF format may be packaged in two ways:

1. **Single GGUF** -- the vision projector is baked into the GGUF. Load it directly.
2. **Separate projector** -- the text model and the vision projector (`mmproj-*.gguf`) are separate files. Use `--mmproj` to load the projector.

**Single GGUF (if the GGUF includes vision):**

```bash
llama-server \
  -m ./models/frontend-design-expert-8b-Q4_K_M.gguf \
  -ngl 99 \
  -c 8192 \
  --host 0.0.0.0 --port 8090
```

**Separate projector (if mmproj file is provided):**

```bash
llama-server \
  -m ./models/frontend-design-expert-8b-Q4_K_M.gguf \
  --mmproj ./models/frontend-design-expert-8b-mmproj-f16.gguf \
  -ngl 99 \
  -c 8192 \
  --host 0.0.0.0 --port 8090
```

Key flags:

| Flag | Purpose |
|---|---|
| `-ngl 99` | Offload all layers to GPU |
| `-c 8192` | Context window size (8K is sufficient for single-component design tasks; increase for full-page work) |
| `--mmproj` | Path to the vision projector GGUF (only needed if separate from the main model) |
| `--port 8090` | Dedicated port for the VL model (keep distinct from the text model port) |

### Verifying the Server

```bash
# Health check
curl http://localhost:8090/health

# Test text generation
curl http://localhost:8090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Write a simple HTML button component with hover state."}],
    "max_tokens": 512
  }'
```

To test vision capability, send a request with an image in the message content (base64-encoded or URL, depending on the server version).

---

## Multi-Model Configuration

The recommended setup runs the VL model alongside a text-only model. Each serves a different purpose:

| Port | Model | Role |
|---|---|---|
| 11434 | Text-only (e.g., Qwen 3.6 27B) | Primary coding, reasoning, all non-visual workflow phases |
| 8081 | nomic-embed-text-v1.5 (CPU) | Embedding for pi-memory vector search |
| 8090 | frontend-design-expert-8b (GPU) | Vision-language tasks: screenshot analysis, design review |

### Example: Three-Server Setup

```bash
# 1. Text generation model (GPU, primary)
llama-server \
  -m ./models/Qwen3.6-27B-MTP-UD-Q5_K_XL.gguf \
  -ngl 99 -c 131072 -fa on -np 1 \
  --host 0.0.0.0 --port 11434

# 2. Embedding model (CPU, zero VRAM)
llama-server \
  -m ./models/nomic-embed-text-v1.5.Q8_0.gguf \
  -ngl 0 --embedding \
  --host 0.0.0.0 --port 8081

# 3. VL web-design model (GPU, secondary)
llama-server \
  -m ./models/frontend-design-expert-8b-Q4_K_M.gguf \
  -ngl 99 -c 8192 \
  --host 0.0.0.0 --port 8090
```

### VRAM Budget

Running two GPU models simultaneously requires enough VRAM for both:

| Configuration | Approximate VRAM |
|---|---|
| Qwen 3.6 27B (Q5_K_XL, 8K ctx) | ~21 GB |
| frontend-design-expert-8b (Q4_K_M, 8K ctx) | ~12 GB |
| **Total** | **~33 GB** |

This fits on a 32+ GB GPU (e.g., RTX 5090 32GB) but is tight. Options for constrained VRAM:

- **Use the 4B Lite model** instead (~8 GB), bringing the total to ~29 GB.
- **Run sequentially**: stop the text model when running VL tasks, and vice versa.
- **Reduce context**: lower `-c` on one or both servers.
- **Use a smaller text model quant**: Q4_K_M for the text model frees several GB.

If running sequentially (one model at a time), a single port can be reused. But the multi-port setup is more practical since the web-design workflow alternates between text and vision phases.

---

## PI Agent Integration

### Web-Design Workflow

The web-design workflow (`.pi/workflows/web-design.yaml`) executes a multi-phase pipeline:

```
scaffold -> brief -> gate-brief -> tokens -> inventory -> gate-plan ->
implement -> verify -> review -> gate-final -> rework -> verify-rework ->
gate-rework -> persist-handoff
```

Each `prompt` node with `fresh_context: true` gets a clean context window and reads prior artifacts from disk (via `$ARTIFACTS_DIR/HANDOFF.md`).

**Where the VL model adds value:**

- **brief** (Phase 1) -- if the user provides a reference screenshot, the VL model can analyze it to extract design intent, color palette, and layout patterns.
- **implement** (Phase 4) -- the VL model can generate code informed by visual references, not just text descriptions.
- **review** (adversarial review) -- the reviewer can compare the rendered output screenshot against the brief and token system, catching visual regressions that text-only review would miss.
- **rework** -- the VL model can verify its fixes against the intended visual outcome.

**Routing requests to the VL model:**

PI Agent connects to its configured LLM endpoint. To route specific workflow phases to the VL model, configure PI to point at the VL model's port for those sessions, or set up a proxy that routes based on whether image content is present in the request.

The simplest approach: run the entire web-design workflow against the VL model endpoint (port 8090). The VL model handles text-only prompts just fine -- it is a full language model with added vision capability. The trade-off is lower text-generation quality compared to a larger text-only model (8B vs 27B for coding tasks).

For the best quality, use a hybrid approach:
1. Run text-heavy phases (brief, tokens, inventory) against the 27B text model.
2. Switch to the VL model for implementation and review phases where screenshots are involved.
3. This requires either manual endpoint switching or a routing layer.

### Web-Design Skill

The web-design skill (`extensions/pi-skills/default-skills/web-design/SKILL.md`) provides the Intent First methodology as injected instructions. It triggers on prompts containing design-related keywords (design, landing page, UI, UX, layout, component, responsive, CSS, Tailwind, etc.).

The skill's four-phase methodology (Intent First, Token System, Inventory, Build) is model-agnostic -- it works with both text-only and VL models. When a VL model is used, the skill's instructions naturally compose with the model's vision capability: the model can follow the structured methodology while also reasoning about provided screenshots.

The skill does not control which model handles the request. That is determined by PI Agent's endpoint configuration.

---

## Performance Notes

### 8B Expert (Recommended)

The 8B Expert model is the recommended choice for web design tasks:

- **Qualifying score: 10/10** with a +1.0 delta over the base Qwen 3.5 VL 8B, demonstrating measurable improvement from fine-tuning.
- **Training loss: 0.246** indicates strong convergence on the frontend design training data.
- At Q4_K_M quantization (4.7 GB), it fits comfortably on a 12 GB GPU.
- Sufficient capacity for the full web-design workflow: understanding design briefs, generating token systems, writing component code, and reviewing rendered screenshots.

### 4B Lite (Constrained Hardware)

The 4B Lite model is an option when VRAM is limited:

- **Qualifying score: 9/10** but with a delta similar to the base model, meaning fine-tuning provided less incremental benefit at this scale.
- **Training loss: 0.325** -- higher than the 8B, indicating less capacity to absorb the training signal.
- At Q4_K_M (2.4 GB), it fits on 8 GB GPUs including Apple M1.
- Suitable for simpler design tasks (single components, small pages). For complex multi-component workflows with adversarial review, prefer the 8B.

### Inference Speed

VL model inference speed depends on the GPU, quantization, and whether images are being processed. Expect:

- **Text-only prompts**: comparable to any 8B/4B model at the same quant level.
- **Image + text prompts**: slower due to vision encoder processing. The first token latency increases with image resolution. For design review tasks (screenshot analysis), this is acceptable since the response quality matters more than speed.

### When to Use the VL Model vs Text-Only

| Task | Recommended model |
|---|---|
| Design brief from text description | Text-only (larger model = better reasoning) |
| Design brief from reference screenshot | VL model |
| Token system definition | Text-only |
| Component inventory | Text-only |
| Code implementation from specs | Text-only (larger model = better code) |
| Code implementation from screenshot | VL model |
| Review: code-only analysis | Text-only |
| Review: screenshot comparison | VL model |
| Rework from text feedback | Text-only |
| Rework from visual comparison | VL model |
