# Grok 4.5 coding capabilities and minions-routing assessment

**Access date:** 2026-07-29  
**Scope:** Grok 4.5 only; GitHub Copilot availability and routing; no production-code changes.

## Executive result

**Verified:** Grok 4.5 is a generally available GitHub Copilot model. The authenticated Copilot model catalog identifies its exact model ID as `grok-4.5`, with picker enabled, `preview: false`, Responses API support, tool calls, parallel tool calls, structured outputs, vision, and configurable `low`/`medium`/`high` reasoning. [GitHub Copilot model catalog](https://api.githubcopilot.com/models) [GitHub supported-models documentation](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

**Recommendation:** Do **not** declare a blanket, provider-neutral replacement for `gpt-5.6-luna` yet. Do adopt `grok-4.5` as the **Copilot-specific explorer replacement**, and pilot it for mechanical and implementer work behind the repository's existing verification and review gates. The evidence is strong for repository Q&A, terminal agency, and agentic coding, but there is no public head-to-head Grok-vs-Luna task result, no official latency/error-rate comparison, and Grok has no `xhigh`/`max` effort equivalent. Those gaps matter because the current standard implementer route uses `xhigh`. [Current standard routing](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/skills/core/models.md) [Current LB routing](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/skills/lb/models.md)

## Identity and the Grok Code Fast 1 distinction

| Item | Verified finding |
|---|---|
| Target model | xAI's model page calls the model **Grok 4.5**, model name `grok-4.5`; aliases include `grok-4.5-latest` and `grok-build-latest`. [xAI model page](https://docs.x.ai/developers/models/grok-4.5) |
| Exact Copilot ID | The live authenticated Copilot catalog returned `id: "grok-4.5"`, `version: "grok-4.5"`, `vendor: "xAI"`, `name: "Grok 4.5"`. [Copilot model catalog](https://api.githubcopilot.com/models) |
| Status | GitHub lists Grok 4.5 as **GA**; the catalog returned `preview: false` and `model_picker_enabled: true`. GitHub's launch notice says rollout is gradual and that Business/Enterprise administrators must enable the policy, which is off by default. [Supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models) [GitHub launch notice](https://github.blog/changelog/2026-07-28-grok-4-5-is-now-available-in-github-copilot) |
| Not the same model | **Grok Code Fast 1** is a separate Copilot model. GitHub deprecated it across Copilot experiences on 2026-05-15; its suggested alternatives were GPT-5 mini and Claude Haiku 4.5. Do not route `grok-code-fast-1` or treat it as a low-latency alias of Grok 4.5. [Grok Code Fast 1 deprecation](https://github.blog/changelog/2026-05-15-grok-code-fast-1-deprecated) |

The Copilot ID is therefore **verified as `grok-4.5`**, not merely inferred from xAI's API naming.

## Capability and limit matrix

The Copilot catalog is the relevant source for a worker launched through this repository's `github-copilot` provider. It is a live, authenticated catalog snapshot, so availability and limits should still be checked at preflight.

| Capability | GitHub Copilot surface | xAI direct API / model docs | Assessment |
|---|---|---|---|
| Context | Catalog: `max_context_window_tokens: 328,000`; `max_prompt_tokens: 200,000`. GitHub's launch notice separately advertises “up to 500,000” tokens. [Copilot catalog](https://api.githubcopilot.com/models) [Launch notice](https://github.blog/changelog/2026-07-28-grok-4-5-is-now-available-in-github-copilot) | xAI model page: 500,000-token context. [xAI model page](https://docs.x.ai/developers/models/grok-4.5) | **Verified conflict.** For Copilot routing, conservatively budget against the catalog's 200k prompt / 328k context limits until the provider documents why the two surfaces differ. |
| Output | Catalog: `max_output_tokens: 128,000`. [Copilot catalog](https://api.githubcopilot.com/models) | xAI REST reference defaults `max_output_tokens` to 128,000 and says the value includes output plus reasoning; it does not state Grok 4.5's hard maximum. [xAI inference reference](https://docs.x.ai/developers/rest-api-reference/inference/chat) | **Verified:** 128k is the Copilot catalog limit. Do not assume the 500k context is also an output allowance. |
| Text and images | Catalog: `vision: true`, one image maximum, 3,145,728-byte maximum, JPEG/PNG. GitHub launch notice explicitly says text and image inputs. [Copilot catalog](https://api.githubcopilot.com/models) [Launch notice](https://github.blog/changelog/2026-07-28-grok-4-5-is-now-available-in-github-copilot) | xAI documents `text, image → text`, 20 MiB maximum image size, no image-count limit, and JPG/JPEG/PNG. [xAI model page](https://docs.x.ai/developers/models) | **Provider-specific limit:** Copilot is materially narrower than direct xAI. Images are not needed by the current minion tool sets. |
| Tool/function calling | Catalog: `tool_calls: true`, `parallel_tool_calls: true`, `structured_outputs: true`; supported endpoint is `/responses`. [Copilot catalog](https://api.githubcopilot.com/models) | xAI documents custom function tools, `auto`/`required`/`none`/forced choice, and parallel function calls by default. [xAI function-calling docs](https://docs.x.ai/developers/tools/function-calling) | **Verified support.** This establishes model tool-call capability, not that every Pi provider tool schema behaves identically; a Copilot smoke test remains necessary. |
| Reasoning controls | Catalog supports exactly `low`, `medium`, `high`. [Copilot catalog](https://api.githubcopilot.com/models) | xAI says Grok 4.5 defaults to `high`, supports `low`/`medium`/`high`, and reasoning cannot be disabled. [xAI reasoning docs](https://docs.x.ai/developers/model-capabilities/text/reasoning) | **Important routing difference:** no Grok `none`, `xhigh`, or `max`. The current standard Luna implementer route uses `xhigh`; map it to Grok `high`, not to a nonexistent value. |
| Streaming | Catalog: `streaming: true`. [Copilot catalog](https://api.githubcopilot.com/models) | xAI documents streaming for reasoning and tool workflows. [xAI function-calling docs](https://docs.x.ai/developers/tools/function-calling) | Compatible in principle; end-to-end worker behavior still needs a smoke test. |

The xAI function-calling page says a request can contain up to 200 tools, while the xAI REST reference says a Chat/Responses request supports at most 128 functions/tools. These are inconsistent official limits; an adapter should use the lower 128 limit unless its provider contract says otherwise. [xAI function-calling docs](https://docs.x.ai/developers/tools/function-calling) [xAI inference reference](https://docs.x.ai/developers/rest-api-reference/inference/chat)

## Coding and agentic evidence

The official Grok 4.5 model card reports the following results. These are **vendor-reported results**, generally with Grok at `high` and comparison models at their listed efforts; they are not Luna comparisons and are not a guarantee for the Copilot/Pi harness. [xAI Grok 4.5 model card, PDF](https://media.x.ai/v1/website/card-7f81d41b.pdf)

| Evaluation | Grok 4.5 | Comparison reported in the card | What it says—and does not say |
|---|---:|---:|---|
| DeepSWE 1.0 | 62.0% | GPT-5.5 `xhigh`: 64.3% | Near the comparison, but not superior; this tests reading, editing, command execution, and verified patches. |
| DeepSWE 1.1 | 53.0% | GPT-5.5 `xhigh`: 67.0% | A material negative result on that updated benchmark. |
| ApexSWE | 51.2% | GPT-5.5 `xhigh`: 43.7% | Positive result on integration and observability engineering tasks. |
| SWE-Bench Pro | 64.7% | GPT-5.5 `xhigh`: 58.6% | Positive result on hard, multi-file repository issues. |
| SWE-Bench Multilingual | 78.0% | GPT-5.5 `xhigh`: 77.8% | Essentially tied, with Grok slightly ahead in this card's run. |
| SWE-Marathon | 29.0% | Opus 4.8 `max`: 26.0% | Positive long-horizon result; no Luna comparison is supplied. |
| ProgramBench | 57.2% | GPT-5.5 `xhigh`: 60.2% | Slightly behind on clean-room behavior reconstruction. |
| Terminal-Bench 2.1 | 83.3% | GPT-5.5 `xhigh`: 83.4% | Essentially tied on terminal agency. |
| SWE-Atlas-QnA | 84.0% | GPT-5.5 `xhigh`: 72.0% | Strong repository-question-answering result; especially relevant to exploration. |

The benchmark owners describe SWE-bench Multilingual as 300 tasks across nine languages and report a resolved percentage; Terminal-Bench describes itself as terminal-environment benchmarks for measuring agent terminal mastery. [SWE-bench owner page](https://www.swebench.com/) [Terminal-Bench owner page](https://www.tbench.ai/) Artificial Analysis describes its coding-agent index as combining DeepSWE, Terminal-Bench, and SWE-Atlas-QnA, with task-normalized pass@1 averages across three attempts; that page also warns that model, harness, settings, cost, and wall time affect comparisons. [Artificial Analysis coding-agent methodology](https://artificialanalysis.ai/agents/coding-agents)

**Inference:** The evidence supports Grok 4.5 as a serious coding/agent model, especially for repository exploration and terminal/tool workflows. It does **not** establish equivalence to Luna in this repository: the card does not evaluate Luna, Copilot's catalog does not publish benchmark scores, and the benchmark scaffolds differ from Pi's RPC worker loop.

## Cost, latency, and reliability tradeoffs

### Cost

For current Copilot usage-based billing, the official table lists these rates per one million tokens:

| Copilot model | Default tier input / cached input / output | Long-context tier input / cached input / output |
|---|---:|---:|
| GPT-5.6 Luna | $1.00 / $0.10 / $6.00 (≤200k input) | $2.00 / $0.20 / $9.00 (>200k input) |
| Grok 4.5 | $2.00 / $0.50 / $6.00 (≤200k input) | $4.00 / $1.00 / $12.00 (>200k input) |

[GitHub Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)

**Verified implication:** at the normal tier, Grok costs 2× Luna for uncached input, 5× for cached input, and the same for output; at the long-context tier it costs 2× input, 5× cached input, and 1.33× output. Reasoning tokens are part of model consumption, so high-effort Grok can cost more than a low-effort command task even when visible output is short. [xAI reasoning docs](https://docs.x.ai/developers/model-capabilities/text/reasoning) [GitHub pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)

GitHub moved to usage-based billing on 2026-06-01. The legacy premium-request multiplier page does **not** list Grok 4.5 and explicitly says legacy multipliers do not apply to the new usage-based system. Therefore there is no officially documented Grok 4.5 premium-request multiplier to use for the current plans. [Legacy multiplier table](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans)

xAI's direct API currently lists different cached-input prices ($0.30/$0.60) and a 2× priority-processing premium. Those are direct xAI API terms, not a substitute for Copilot billing. [xAI pricing](https://docs.x.ai/developers/pricing)

### Latency and reliability

**Verified:** GitHub characterizes Grok 4.5 as designed for fast, agentic coding and says its internal testing was strong on terminal tasks, parallel tool dispatch, exploration, unblocking, and time-sensitive coding. The xAI model card claims high token efficiency and results in half as many steps as other frontier models. [GitHub launch notice](https://github.blog/changelog/2026-07-28-grok-4-5-is-now-available-in-github-copilot) [xAI model card](https://media.x.ai/v1/website/card-7f81d41b.pdf)

**Evidence gap:** neither source supplies a reproducible Grok-vs-Luna p50/p95 latency table, timeout rate, tool-call error rate, or Copilot availability SLA. The Copilot catalog supplies capabilities, not service reliability. xAI also says model access can vary by geography and account limitations. [xAI pricing and availability notes](https://docs.x.ai/developers/pricing)

**Inference:** Parallel tool calls and the strong terminal/Q&A results make Grok promising for this repository's background workers, but network/provider latency and rate limiting remain deployment questions. The repository's six-worker concurrency limit and verification gate should remain unchanged during a pilot. [Current worker/concurrency implementation](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/extensions/pi-minions/orchestrator.mjs#L304-L372)

## Role-by-role decision

The current roles and tools are defined by the orchestrator; mechanical uses `read,bash,edit,write`, explorer is read-only (`read,bash,grep,find,ls`), and implementer has the full repository editing/search set. [Current role tools and routes](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/extensions/pi-minions/orchestrator.mjs#L15-L60)

| Role | Decision | Reasoning |
|---|---|---|
| **Mechanical** | **Conditional replacement for Copilot; pilot first** | Low effort exists, tool calls and parallel calls are verified, and GitHub specifically reports strong terminal/direct-action behavior. But Grok cannot disable reasoning, costs more on input, and Terminal-Bench is only effectively tied with GPT-5.5 in the vendor card. Pure shell/git work is the least valuable place to pay for a larger model. |
| **Explorer** | **Yes; strongest replacement case** | GitHub explicitly names exploration as a strong fit; SWE-Atlas-QnA is 84.0% in the vendor card versus GPT-5.5's 72.0%. Use medium for normal read-only discovery and high for architecture-wide questions. This remains an inference about Luna replacement because Luna is not benchmarked. |
| **Implementer** | **Promising, but not yet a blanket replacement** | SWE-Bench Pro, ApexSWE, multilingual SWE-bench, and long-horizon results are strong, and tool/structured-output support is present. Counterevidence includes DeepSWE 1.1, ProgramBench, and terminal results that are not better than the comparison. The current standard route's `xhigh` cannot be represented; use `high` and rely on verification/review. |

## Architectural implication: provider-specific matrices

The current Pi runtime captures the parent provider, accepts `openai-codex` or `github-copilot`, requires the same model IDs for either provider, and qualifies every worker as `<provider>/<model>`. Its `ROUTES`, `ROUTE_OVERRIDES`, and `REQUIRED_MODELS` are global rather than provider-keyed. [Provider affinity and global matrices](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/extensions/pi-minions/orchestrator.mjs#L7-L50) [Provider preflight and qualification](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/extensions/pi-minions/orchestrator.mjs#L427-L464)

**Verified architectural consequence:** Grok 4.5 is a Copilot catalog model; the repository's OpenAI Codex provider cannot be assumed to expose it. Conversely, Copilot and direct xAI/Codex surfaces can expose different context, image, output, reasoning, and tool limits. A single universal matrix now hides real capability differences. [Copilot catalog](https://api.githubcopilot.com/models) [xAI model page](https://docs.x.ai/developers/models/grok-4.5)

**Recommendation (inference):** retain semantic roles in the core protocol, but make the route selection key `(provider, variant, role, override)` and derive required models from that provider's matrix. Add provider capability metadata for allowed reasoning levels and tool contract. Preflight should reject an unavailable route before spawning, with no silent cross-provider fallback—the current no-fallback behavior is the safer policy. Record the resolved provider/model/effort in the board, as the repository already requires. [Core route-discipline documentation](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/skills/core/models.md#route-discipline)

## Proposed Copilot-only routing matrix

This is a **proposal only**; production code was not changed. `grok-4.5` is the verified Copilot ID. The Grok `high` substitutions are intentional: Copilot exposes no `xhigh` or `max` for this model.

### Standard profile

| Role / override | Proposed Copilot model | Effort | Notes |
|---|---|---:|---|
| Frontier | `gpt-5.6-sol` | medium | Preserve dispatch/triage model. |
| Mechanical | `grok-4.5` | low | Pilot; verification remains mandatory. |
| Explorer | `grok-4.5` | high | Use medium for ordinary discovery if cost/latency wins. |
| Implementer | `grok-4.5` | high | Replaces Luna `xhigh` only as a bounded, review-gated trial. |
| Architect | `gpt-5.6-sol` | medium | No evidence requires changing this role. |
| Reviewer | `gpt-5.6-sol` | low | Preserve independent review. |
| Planner | `gpt-5.6-terra` | high | Preserve structured planning. |
| `mechanical-judgment` | `grok-4.5` | high | Highest available Grok effort; no xhigh/max. |
| `escalate-entry` | `grok-4.5` | high | Then escalate to Sol medium if verification still fails. |

### Low-budget profile

| Role / override | Proposed Copilot model | Effort | Notes |
|---|---|---:|---|
| Frontier | `gpt-5.6-sol` | medium | Preserve dispatch/triage model. |
| Mechanical | `grok-4.5` | low | Costs more than Luna; validate whether quality offsets it. |
| Explorer | `grok-4.5` | medium | Best cost-aware Copilot explorer setting. |
| Implementer | `grok-4.5` | high | Replaces Luna high; keep verify/review gates. |
| Architect | `grok-4.5` | high | Copilot-only substitution for LB Luna. |
| Reviewer | `gpt-5.6-sol` | low | Preserve independent review. |
| Planner | `grok-4.5` | high | Copilot-only substitution for LB Luna. |
| `mechanical-judgment` | `grok-4.5` | high | Substitute for unavailable Luna xhigh. |
| `escalate-entry` | `grok-4.5` | high | Escalate to Sol low/medium according to provider matrix. |

The corresponding `openai-codex` matrix should remain on the existing Luna routes until a separate Codex-supported model is selected; do not put a Copilot-only Grok ID into a universal required-model list. [Existing standard matrix](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/skills/core/models.md) [Existing LB matrix](https://github.com/PaoloDelCasale/copilot-minions/blob/06c1cf7758b1d14ed4d332e4bf38b471911da2ce/skills/lb/models.md)

## Concise recommendation

Use `github-copilot/grok-4.5` for **explorer now**, and for mechanical/implementer only as a **Copilot-specific, verification-gated pilot**. Do not claim complete Luna replacement until a repository-local A/B test measures success-after-verification, retries, tool-call failures, wall time, and Copilot AI-credit cost across representative mechanical, explorer, and implementer tasks. Keep `openai-codex` provider routing separate and unchanged in the absence of an equivalent Codex model decision.
