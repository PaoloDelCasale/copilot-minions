# Disciplines

Minions is the orchestration layer. Engineering behaviour comes from separate
discipline skills, referenced by name and never forked:

| Work | Skill | Inline fallback |
|------|-------|-----------------|
| Planning interview | `grilling` | One decision per frontier turn |
| PRD | `to-spec` (legacy `to-prd`) | Synthesize without interviewing or publishing |
| Issues | `to-tickets` (legacy `to-issues`) | Tracer-bullet slices with dependency edges |
| Implement | `implement` | Scoped edit, verify, commit, stop before review |
| Fix-review | `tdd` | Reproduce with a failing test, fix, verify |
| Review | `code-review` | Correctness-focused independent diff review |
| Bug diagnosis | `diagnosing-bugs` | Reproduce, minimize, hypothesize, instrument, fix |
| Design seams | `codebase-design`, `domain-modeling` | Explicit module and domain boundaries |

Workers explicitly invoke a discipline when their platform supports skill invocation.
If unavailable, they follow the complete inline constraints in [`prompts.md`](prompts.md).
Any discipline instruction to interview, publish, or run review inside implementation
is overridden: the worker returns a STATUS, and the frontier owns those actions.

The platform-aware updater keeps `implement`, `to-spec`, and `to-tickets` current from
`mattpocock/skills`. Copilot registers the cache through its CLI. Codex links the cache
under `~/.agents/skills`.

