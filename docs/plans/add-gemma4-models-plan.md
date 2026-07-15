# Plan: Add Gemma 4 E2B and E4B as Local Summarization Models

## Overview

Add two new Unsloth-optimized Gemma 4 QAT-mobile models to Adamant's built-in AI model options:

| Model | ID | Disk Size | Context | VRAM | Quality Tier |
|-------|-----|-----------|---------|------|-------------|
| **Gemma 4 E2B QAT-mobile** | `gemma4:e2b` | ~2.2 GB | 128K | ~3 GB | Replacement for Gemma 3 1B |
| **Gemma 4 E4B QAT-mobile** | `gemma4:e4b` | ~3.2 GB | 128K | ~5 GB | Replacement for Gemma 3 4B |

Both are **Apache 2.0** licensed, multimodal (text/image/audio), support 140+ languages, and use a custom wNa8o8 mixed-precision quantization (TQ2_0/Q4_0/Q8_0) that's dramatically more efficient than standard Q4.

---

## Prerequisites / Investigation

### llama.cpp Compatibility (CRITICAL — needs verification)

llama.cpp added full Gemma 4 support via PR #21534 (merged April 10, 2026), fixing attention masks, RoPE scaling, and GGUF conversion. However, the bundled `llama-helper` binary in Adamant needs to be at a build that includes this support.

**Check this first** before any other work:
1. Find the `llama-helper` binary version used: check `llama-helper/Cargo.toml` or build scripts for the pinned llama.cpp commit
2. Verify it's post-PR #21534 (or from April 2026+)
3. If not, `llama-helper` needs to be rebuilt with an updated llama.cpp

### Prompt Template

Gemma 4 uses different tokens than Gemma 3. The correct template format (from Unsloth docs):

```
<|turn|>system
{system_prompt}<|turn|>
<|turn|>user
{user_prompt}<|turn|>
<|turn|>model
```

**Alternative approach**: Modern llama.cpp can auto-detect the chat template from GGUF metadata. If the sidecar supports passing `--jinja` or auto-template, we could skip hardcoding the template entirely for these models and send raw messages. This would be cleaner. Needs investigation of `llama-helper`'s capabilities.

---

## Files to Change

### 1. `frontend/src-tauri/src/summary/summary_engine/models.rs`

#### A. Add fallback URLs in `get_fallback_urls()` (~line 66)

Add entries for the two new models pointing to Unsloth's HuggingFace repos:

```rust
"gemma4:e2b" => vec![
    "https://huggingface.co/unsloth/gemma-4-E2B-it-qat-mobile-GGUF/resolve/main/gemma-4-E2B-it-qat-UD-Q2_K_XL.gguf".to_string(),
],
"gemma4:e4b" => vec![
    "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-mobile-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q2_K_XL.gguf".to_string(),
],
```

#### B. Add model definitions to `get_available_models()` (~line 90)

```rust
// Gemma 4 E2B — Ultra-efficient, replaces Gemma 3 1B tier
ModelDef {
    name: "gemma4:e2b".to_string(),
    display_name: "Gemma 4 E2B — Efficient (New)".to_string(),
    gguf_file: "gemma-4-E2B-it-qat-UD-Q2_K_XL.gguf".to_string(),
    template: "gemma4".to_string(),
    download_url: "https://huggingface.co/unsloth/gemma-4-E2B-it-qat-mobile-GGUF/resolve/main/gemma-4-E2B-it-qat-UD-Q2_K_XL.gguf".to_string(),
    size_mb: 2190,   // ~2.19 GB
    context_size: 131072,  // 128K
    layer_count: 24,  // confirm from actual GGUF metadata
    sampling: SamplingParams {
        temperature: 0.2,
        top_k: 40,
        top_p: 0.9,
        stop_tokens: vec!["<|turn|>".to_string()],
    },
    description: "Next-gen efficient • ~2.2 GB • 128K context • Replaces Gemma 3 1B".to_string(),
},
// Gemma 4 E4B — Balanced, replaces Gemma 3 4B tier
ModelDef {
    name: "gemma4:e4b".to_string(),
    display_name: "Gemma 4 E4B — Balanced (New)".to_string(),
    gguf_file: "gemma-4-E4B-it-qat-UD-Q2_K_XL.gguf".to_string(),
    template: "gemma4".to_string(),
    download_url: "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-mobile-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q2_K_XL.gguf".to_string(),
    size_mb: 3220,   // ~3.22 GB
    context_size: 131072,  // 128K
    layer_count: 32,  // confirm from actual GGUF metadata
    sampling: SamplingParams {
        temperature: 0.2,
        top_k: 40,
        top_p: 0.9,
        stop_tokens: vec!["<|turn|>".to_string()],
    },
    description: "Next-gen quality • ~3.2 GB • 128K context • Replaces Gemma 3 4B".to_string(),
},
```

**Verified layer_count**: E2B=36 layers, E4B=42 layers (from actual GGUF metadata).

#### C. Add Gemma 4 prompt template constants (after GEMMA3_TEMPLATE, ~line 208)

```rust
/// Gemma 4 chat template format
/// Uses <|turn|> delimiters (different from Gemma 3's <start_of_turn>/<end_of_turn>)
pub const GEMMA4_TEMPLATE: &str = "\
<|turn|>system
{system_prompt}<|turn|>
<|turn|>user
{user_prompt}<|turn|>
<|turn|>model
";
```

#### D. Update `format_prompt()` match statement (~line 245)

```rust
"gemma4" => GEMMA4_TEMPLATE,
```

### 2. `frontend/src-tauri/src/summary/summary_engine/commands.rs`

#### A. Update model priority in `builtin_ai_get_available_summary_model()` (~line 320)

Gemma 4 models should be preferred over Gemma 3 when available:

```rust
.filter(|m| matches!(m.status, ModelStatus::Available))
.max_by_key(|m| {
    match m.name.as_str() {
        "gemma4:e4b" => 5,  // Highest priority — best quality
        "gemma4:e2b" => 4,  // Second — great quality, low VRAM
        "gemma3:4b" => 3,
        "gemma3:1b" => 2,
        _ => 1,
    }
})
```

#### B. Update `builtin_ai_get_recommended_model()` (~line 368)

Adjust recommendations based on system RAM:

```rust
let recommended = if is_macos && system_ram_gb > 16 {
    "gemma4:e4b"       // macOS + >16GB RAM: best quality
} else if system_ram_gb > 8 {
    "gemma4:e2b"       // 8-16GB: efficient next-gen
} else {
    "gemma3:1b"        // <8GB: fall back to smallest
};
```

### 3. `frontend/src-tauri/src/summary/llm_client.rs`

**No changes needed**. The `generate_summary()` function already calls `summary_engine::client::generate_with_builtin()` for `BuiltInAI` provider, which uses `model_def.template` dynamically. Model lookup is by name, so new models work automatically.

### 4. `frontend/src-tauri/src/summary/processor.rs`

**No changes needed**. The processor reads `context_size` from the model definition and uses it for chunking. Since Gemma 4 E2B/E4B have 128K context (vs 32K for current models), they handle much larger chunks — but the processor already adapts dynamically.

### 5. `frontend/src-tauri/src/summary/service.rs`

**No changes needed**. Same reasoning as processor — uses model definitions dynamically.

### 6. `frontend/src/components/onboarding/steps/DownloadProgressStep.tsx`

Add new entries to `SUMMARY_OPTIONS` array (~line 63):

```typescript
const SUMMARY_OPTIONS: SummaryOption[] = [
  {
    id: 'gemma4:e4b',
    label: 'Gemma 4 E4B',
    size: '~3.2 GB',
    sizeMb: 3220,
    desc: '🚀 Next-gen • Best quality • 128K context • Replaces Gemma 3 4B',
    badge: 'Best (New)',
    recommended: true,
  },
  {
    id: 'gemma4:e2b',
    label: 'Gemma 4 E2B',
    size: '~2.2 GB',
    sizeMb: 2190,
    desc: '⚡ Ultra-efficient • 128K context • Replaces Gemma 3 1B',
    badge: 'Efficient (New)',
  },
  // ... existing entries
];
```

**Decision**: These are **additional** options alongside existing models — never replacements. Gemma 3 1B, Gemma 3 4B, Qwen 1.7B, and DeepSeek R1 all stay unchanged.

Also update `SUMMARY_MODEL_IDS` array (~line 312) if referenced.

### 7. `frontend/src/components/ModelSettingsModal.tsx`

**Likely no changes needed** — the `BuiltInModelManager` component dynamically lists all models from Rust, so new models appear automatically in the settings UI. Verify the `modelOptions` map doesn't hardcode model lists for `builtin-ai` provider.

### 8. `frontend/src/components/ChatBubble/ChatModelPicker.tsx`

**No changes needed** — this is for the chat feature, not summary. The summary model default is handled by `builtin_ai_get_recommended_model()`.

### 9. `frontend/src/lib/builtin-ai.ts`

**No changes needed** — the API wrapper is model-agnostic.

### 10. `frontend/src/database/repositories/setting.rs` & `setup.rs`

**No changes needed** — model name is just a string stored in the database. New model names work the same way as old ones.

---

## Migration / Compatibility

### Existing Users Who Already Downloaded Gemma 3 Models

- **Gemma 3 model files remain on disk** and usable. The model manager scans the models directory and finds them.
- The recommended/default model will switch to Gemma 4 variants.
- Users can switch between any downloaded model (Gemma 3 or Gemma 4) in Model Settings.
- No automatic migration needed — files from different models don't conflict.

### Sidecar (llama-helper) Compatibility

If `llama-helper` is too old to support Gemma 4 architecture:
- **Symptom**: Sidecar crashes or produces garbled output when loading a Gemma 4 GGUF
- **Fix**: Rebuild `llama-helper` with a llama.cpp version that includes PR #21534
- **Mitigation**: If rebuilding isn't feasible initially, the models can still be surfaced in the UI but fail gracefully with a clear error message

---

## Testing Checklist

- [x] `llama-helper` supports Gemma 4 GGUF architecture — **llama-cpp-2 v0.1.151**
- [x] Downloaded E2B and E4B GGUF — **both load and generate text on M1 Pro Metal**
- [x] Prompt template (`<|turn|>`) produces correct output — **model responds correctly**
- [ ] Verify 128K context works for large meeting transcripts — **pending full app test**
- [ ] Test model switching: Gemma 3 → E2B → E4B → Gemma 3 — **pending full app test**
- [ ] Test onboarding flow with new models as default — **pending full app test**
- [x] Disk space: E2B ~2.4 GB, E4B ~3.8 GB — **verified from actual downloads**
- [x] `layer_count`: E2B=36, E4B=42 — **verified from actual GGUF metadata**
- [x] Model priority: E4B(5) > E2B(4) > Gemma 3 4B(3) > Gemma 3 1B(2) — **implemented in commands.rs**

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `llama-helper` too old for Gemma 4 | ✅ **Resolved** — Updated to llama-cpp-2 v0.1.151 | — | Verified E2B/E4B load and generate on M1 Pro Metal |
| QAT variant crashes on Metal | ✅ **Resolved** — Use non-QAT variant instead | — | Non-QAT `UD-Q2_K_XL` works on Metal; QAT's `tq2_0` quant lacks Metal shader |
| Incorrect `layer_count` causing bad GPU offloading | ✅ **Resolved** — Verified: E2B=36, E4B=42 | — | Confirmed from actual GGUF metadata |
| Prompt template tokens wrong for Gemma 4 | ✅ **Resolved** — `<\|turn\|>` template verified correct | — | Tested with real inference; model responded coherently |
| 128K context causes OOM on low-RAM machines | Low | Medium — crash | Processor already adapts chunking based on available RAM |
| Download URL changes (Unsloth renames repo) | Low | Medium — download fails | Fallback URLs in `get_fallback_urls()`; monitor Unsloth's repo naming |
