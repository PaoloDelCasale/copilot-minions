# Model rationale

Why each Copilot model was chosen when porting from Cursor, and why the stack later
moved to an **all-GPT-5.6 single family** (Sol / Terra / Luna). The original skill
optimized cost around Cursor's first-party `composer-2.5`; Copilot bills usage-based
**AI credits** (per-token), so roles are chosen by measured price/quality fit, not by
copying names.

## Why all-GPT-5.6 (dropping Sonnet, Opus, Kimi)

Grounded in per-token pricing + two hands-on practitioner setups (r/codex community):
- **Cost:** with AI credits, Sonnet 5 ($2/$10 intro, rising to $3/$15 on 2026-09-01,
  plus a ~1.35× tokenizer penalty) and Opus 4.8 are not cheaper than a Luna-led stack.
  Luna is the cheapest GPT-5.6 ($1/$6). Sol/Terra cost more per token but are used
  sparingly (complex + planning only).
- **Quality where it matters:** Luna is *"good enough when the task is clearly
  explained and reasonably limited"* — exactly what tracer-bullet slices + tight spawn
  specs give it. Real orchestrator setups run **Luna High/XHigh as the implementer**
  (even features with tests) and **Sol Low as the reviewer**. Escalate only when a tier
  actually struggles; *"starting every task with Terra or Sol is a waste of quota."*
- **Coherence:** one model family = one billing profile, one mental model, no
  cross-provider surprises.

## Mapping

| Role | Cursor original | Copilot choice | Why |
|------|-----------------|----------------|-----|
| Frontier / dispatch | `gpt-5.6-sol-max` | `gpt-5.6-sol` medium | Sol is the strongest tier but burns tokens fast; the frontier runs every turn and is mostly light dispatch/triage, with real reasoning only in decompose. `medium` is the community's "strong default" for Sol and keeps the per-turn cost down; bump to high/max manually for an unusually hard decomposition. |
| Mechanical / commit / shell | `composer-2.5` | `gpt-5.6-luna` low | No Composer in Copilot. Luna at `low` effort is fast and cheap for commits, renames, git/`gh`/worktree plumbing — the community's `commit-pusher` role. Replaces the earlier `kimi-k2.7-code` (retired to keep a single family). |
| Explore (delegated) | `composer-2.5` | `gpt-5.6-luna` high | Read-only discovery; Luna `high` matches the community `code-explorer` role. |
| Quick implement (1–2 files) | — | `gpt-5.6-luna` high | Small, well-defined changes — Luna `high` (`quick-implementer`). |
| **Default implement** (feature + tests) | `cursor-grok-4.5-high` | `gpt-5.6-luna` xhigh | The daily driver. Community reports Luna **XHigh** as best for "normal bug fix or clearly-scoped feature"; enough reasoning to pass the verify gate first try, at Luna's low token price. |
| Complex up-front / rescue | `cursor-grok-4.5-high` | `gpt-5.6-sol` medium | Architecture, auth, payments, migrations, or a failed Luna/Terra attempt → Sol `medium` (community's tier for "complex bug, migrations"). Reserve Sol high/max for when medium fails. |
| Implement escalation | composer → grok | `gpt-5.6-luna` xhigh → `gpt-5.6-terra` medium → `gpt-5.6-sol` medium → `gpt-5.6-sol` high/max → split/ask | Climb model + effort together; escalate only on real struggle. |
| Review | `gpt-5.6-terra-high` | `code-review` agent + `gpt-5.6-sol` low | Copilot's dedicated `code-review` agent, pinned to Sol `low`: strong, independent judgment cheap enough for a diff pass — the community `code-reviewer` config. An independent Sol reviewer over a Luna implementer catches the cheap-model slips. |
| PRD / issues synthesis | `gpt-5.6-terra-high` | `gpt-5.6-terra` high | Terra suits structured synthesis; planning volume is low so its higher per-token rate barely registers. |

## Notes

- Effort (`low`/`medium`/`high`/`xhigh`/`max`) is a **separate parameter** in
  Copilot, not baked into the model name as in Cursor.
- No formal Copilot benchmark scorecard is included — these are reputation/fit
  choices, not measured numbers. Adjust per your own experience with
  `use <model>` overrides.
