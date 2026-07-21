# Model rationale

Why each Copilot model was chosen when porting from Cursor. The original skill
optimized cost around Cursor's first-party `composer-2.5`; Copilot has a different
model pool and cost model (premium requests), so roles are remapped by best fit,
not by copying names.

## Mapping

| Role | Cursor original | Copilot choice | Why |
|------|-----------------|----------------|-----|
| Frontier / dispatch | `gpt-5.6-sol-max` | `gpt-5.6-sol` high | Sol exists natively in Copilot. Frontier turns are mostly light dispatch (board + STATUS lines); real reasoning is concentrated in decompose/triage, so `high` covers it without paying `max` latency/cost on every turn. `max` was judged overkill for a dispatch-only role. |
| Mechanical / shell / commit / explore | `composer-2.5` | `kimi-k2.7-code` | No Composer in Copilot. Kimi K2.7 Code is a fast, low-cost, code-specialized model — the right profile for bulk/mechanical work. (Composer is widely *speculated* to derive from a Kimi-family base, but this is **unconfirmed**; the choice stands on fit, not lineage.) Note: `kimi-k2.7-code` does not accept `reasoning_effort`. |
| Complex implement / UI | `cursor-grok-4.5-high` | `claude-sonnet-5` high | No Grok in Copilot. Sonnet 5 is a strong agentic-coding model with a good quality/cost ratio, cheaper than Opus for the common case. |
| Implement escalation | composer → grok | `kimi-k2.7-code` → `claude-sonnet-5` high → `claude-opus-4.8` → split/ask | Three clean tiers: cheap mechanical → strong default → top-tier rescue, then human. |
| Review | `gpt-5.6-terra-high` | `code-review` agent + `claude-opus-4.8` | Copilot has a dedicated `code-review` agent type. Opus is strict and high-signal at finding real bugs — what you want from an independent reviewer. |
| PRD / issues synthesis | `gpt-5.6-terra-high` | `gpt-5.6-terra` high | Terra exists in Copilot and is well suited to structured synthesis; kept faithful to the original. |

## Notes

- Effort (`low`/`medium`/`high`/`xhigh`/`max`) is a **separate parameter** in
  Copilot, not baked into the model name as in Cursor.
- No formal Copilot benchmark scorecard is included — these are reputation/fit
  choices, not measured numbers. Adjust per your own experience with
  `use <model>` overrides.
