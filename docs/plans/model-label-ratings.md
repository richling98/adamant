# Model Label Ratings

Ratings for each summary model's download card labels. Speed and Intelligence use star emojis (out of 5). Space is the actual download size in GB.

## Gemma 4 E4B — Premium

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐ | 12–35 tok/s on M1 Pro. Biggest model → slowest generation. |
| Intelligence = | ⭐⭐⭐⭐⭐ | MoE architecture, largest knowledge base, best instruction following, 128K context. Top-tier summarization. |
| Space required = | ~3.8 GB | UD-Q2_K_XL quant. |

## Gemma 4 E2B — Next-gen

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐⭐⭐ | 27–42 tok/s on M1 Pro. Surprisingly fast for its quality tier thanks to MoE sparse activation. |
| Intelligence = | ⭐⭐⭐⭐ | MoE, 128K context, strong quality-per-byte. Beats Gemma 3 4B at similar size. |
| Space required = | ~2.4 GB | UD-Q2_K_XL quant. |

## Gemma 3 4B — Balanced

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐⭐ | 21–40 tok/s on M1 Pro. Medium model, moderate speed. |
| Intelligence = | ⭐⭐⭐ | Solid and reliable for summarization. Good chat quality. 32K context (not 128K). |
| Space required = | ~2.4 GB | Q4_K_M quant. |

## Qwen3 1.7B — Smart (Best Value)

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐⭐⭐ | 43–85 tok/s on M1 Pro. Fast for its size. Thinking mode is disabled for summarization (toggled off in code). |
| Intelligence = | ⭐⭐⭐⭐ | Very smart for its size. Thinking mode available for complex tasks. 119 languages. Apache 2.0 license. |
| Space required = | ~1.2 GB | Q4_K_M quant. |

## DeepSeek R1 Distill 1.5B — Reasoning

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐⭐ | Raw tok/s is high (85–110), but always-on Chain-of-Thought generates 2–3× more tokens per summary. Effective speed is ~1/3 of raw. |
| Intelligence = | ⭐⭐⭐⭐ | Excellent for complex reasoning tasks. May overthink simple summaries (verbose output). Chain-of-thought can be insightful for nuanced meeting analysis. |
| Space required = | ~1.1 GB | Q4_K_M quant. |

## Gemma 3 1B — Fast

| Metric | Rating | Notes |
|--------|--------|-------|
| Speed = | ⭐⭐⭐⭐⭐ | 42–55 tok/s on M1 Pro. Smallest model → fastest generation. Runs on any laptop. |
| Intelligence = | ⭐⭐ | Basic. Good for quick, short summaries. Limited depth and nuance compared to larger models. 32K context. |
| Space required = | ~1.0 GB | Q8_0 quant. |
