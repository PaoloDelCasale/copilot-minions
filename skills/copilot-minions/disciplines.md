# Disciplines

copilot-minions is the **orchestration layer** (a dispatch-only frontier). The
*discipline* each worker follows — how it implements, tests, reviews, specs — comes
from separate **discipline skills**, most of them from
[`mattpocock/skills`](https://github.com/mattpocock/skills). The frontier dispatches;
the disciplines do the actual engineering.

Original `minion-orchestrator` assumed these skills were installed alongside it
(its worker prompts carried `Skill: implement`, `Skill: code-review`,
`Skill: tdd`, `Skill: to-prd`, `Skill: to-issues`). This port keeps that wiring,
remapped to Copilot names, **with an inline fallback** so a worker still behaves
correctly when a discipline skill is not installed.

## How wiring works

Each worker prompt in [`prompts.md`](prompts.md) may carry a `Discipline:` line:

```
Discipline: load skill `<name>` if available (invoke the skill tool with "<name>");
otherwise follow the inline Constraints in this prompt.
```

The inline `Constraints` block in every prompt already encodes the essential
discipline (verify gate, commit rules, red-green for fix, tracer-bullet slices), so
a missing skill degrades gracefully rather than breaking the loop.

## Mapping (Copilot)

| Worker | Discipline skill | Status in this env | Fallback if missing |
|--------|------------------|--------------------|---------------------|
| planning grill | `grilling` | installed | frontier asks one question per turn via `ask_user` |
| prd | `to-spec` (was `to-prd`) | **missing** | synthesize a spec from the brief; no interview; do not publish |
| issues | `to-tickets` (was `to-issues`) | **missing** | break plan into tracer-bullet slices, each with blocked-by edges |
| implement | `implement` | **missing** | prompt Constraints: edit only Files, verify gate, commit before DONE |
| fix-review | `tdd` | installed | red-green-refactor: failing test first, then fix; re-run verify |
| review | `code-review` agent type (built-in) | built-in | Copilot `code-review` agent type; Matt's `code-review` skill optional |
| any bug-fix task | `diagnosing-bugs` | installed | reproduce → minimise → hypothesise → instrument → fix |
| design seams | `codebase-design`, `domain-modeling` | installed | model-invoked; workers lean on them for module/seam decisions |

Names track [`mattpocock/skills`](https://github.com/mattpocock/skills) current
naming (`to-spec` / `to-tickets`), which supersede the original `to-prd` /
`to-issues`.

## Installing the missing disciplines

The `implement`, `to-spec`, and `to-tickets` skills live in Matt Pocock's repo
under `skills/engineering/`. They are written for Claude Code / Cursor and assume
slash-commands + an issue tracker, so they need light adaptation for Copilot CLI.
Until installed, the inline fallbacks above keep copilot-minions fully functional.

Recommended update mechanism: clone `mattpocock/skills`, `git pull` to track
changes (the repo uses changesets + a CHANGELOG), and copy the wanted skills into
`~/.agents/skills` or `~/.copilot/skills`, adapting names/triggers as needed.
