# LLM Setup Guides

Setup guides for running PI Agent with different model and GPU combinations. Each guide covers the inference server command, PI Agent configuration (`models.json`), VRAM requirements, and troubleshooting.

## Available Setups

| Model | GPU | VRAM | Server | Guide |
|---|---|---|---|---|
| Qwen 3.6-27B Dense MTP | RTX 5090 (32 GB) | ~29 GB at 131K ctx | llama-server | [qwen-3.6-27b-mtp-rtx5090.md](qwen-3.6-27b-mtp-rtx5090.md) |
| Qwen 3.5 VL 8B Expert (fine-tuned) | RTX 3060/4070/M2 (12 GB) | ~12 GB | llama-server | [qwen-3.5-vl-web-design.md](qwen-3.5-vl-web-design.md) |
| Qwen 3.5 VL 4B Lite (fine-tuned) | RTX 3060 8GB/M1 (8 GB) | ~8 GB | llama-server | [qwen-3.5-vl-web-design.md](qwen-3.5-vl-web-design.md) |
| DeepSeek V4 Flash 284B MoE | RTX PRO 6000 (96 GB) | ~88 GB at 210K ctx | ds4-server | [deepseek-v4-flash-rtx-pro-6000.md](deepseek-v4-flash-rtx-pro-6000.md) |

## Common Setup Steps

All setups share the same PI Agent configuration flow:

1. Start your inference server (llama-server, ds4-server, etc.)
2. Edit `~/.pi/agent/models.json` with the model's endpoint and settings
3. Optionally start an embedding server for pi-memory (nomic-embed-text on CPU, port 8081)
4. Run `pi` in your project directory

## Adding a New Setup

To document a new model/GPU combination, create a file in this directory covering:

- **Hardware**: GPU model, VRAM, any special requirements
- **Model**: name, quantization, file size, where to download
- **Server command**: full command with all flags explained
- **VRAM budget**: usage at different context sizes
- **PI Agent config**: complete `models.json` entry
- **Performance**: generation speed, any benchmark data
- **Troubleshooting**: common issues and fixes

## Embedding Server

Most setups pair a generation model (GPU) with an embedding model (CPU) for pi-memory's vector search. The standard embedding setup works with any generation model:

```bash
llama-server \
  -m /path/to/nomic-embed-text-v1.5.Q8_0.gguf \
  --port 8081 --embedding --ctx-size 2048 -ngl 0
```

This uses ~140 MB RAM and zero VRAM. The pi-memory extension defaults to `http://localhost:8081` for embeddings.
