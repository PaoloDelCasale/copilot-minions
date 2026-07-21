# Disciplines

copilot-minions is the **orchestration layer** (a dispatch-only frontier). The
*discipline* each worker follows — how it implements, tests, reviews, specs — comes
from separate **discipline skills**, most of them from
[`mattpocock/skills`](https://github.com/mattpocock/skills). The frontier dispatches;
the disciplines do the actual engineering.

**Reference, don't fork.** copilot-minions does **not** bundle or modify Matt's
skills. It references them by name and keeps them updatable from upstream (see
[Updating](#updating-the-disciplines)). Every Copilot-specific adaptation lives in the
worker `Discipline:` lines in [`prompts.md`](prompts.md), never in the skill files —
so `git pull` upstream never conflicts.

Original `minion-orchestrator` assumed these skills were installed alongside it
(its worker prompts carried `Skill: implement`, `Skill: to-prd`, `Skill: to-issues`,
`Skill: tdd`, `Skill: code-review`). This port keeps that wiring, **with an inline
fallback** so a worker still behaves correctly when a discipline skill is missing.

## Naming (upstream rename)

Matt renamed two skills on `main`: **`to-prd` → `to-spec`** and
**`to-issues` → `to-tickets`**. copilot-minions tracks `main` (for real auto-update),
so it uses the current names `to-spec` / `to-tickets`. The worker `Discipline:` lines
also accept the **legacy** names `to-prd` / `to-issues` for older pinned installs
(e.g. a marketplace clone frozen at an earlier commit). The inline fallback covers the
case where neither is present.

## How wiring works

Each worker prompt in [`prompts.md`](prompts.md) may carry a `Discipline:` line:

```
Discipline: load skill `<name>` if available (invoke the skill tool with "<name>");
otherwise follow the inline Constraints in this prompt.
```

The inline `Constraints` block in every prompt already encodes the essential
discipline (verify gate, commit rules, red-green for fix, tracer-bullet slices), so a
missing skill degrades gracefully rather than breaking the loop.

## Mapping (Copilot)

| Worker | Discipline skill | Status in this env | Fallback / override |
|--------|------------------|--------------------|---------------------|
| planning grill | `grilling` | installed (personal) | frontier asks one question per turn via `ask_user` |
| prd | `to-spec` (legacy `to-prd`) | installed (custom) | synthesize a spec from the brief; no interview; no publish |
| issues | `to-tickets` (legacy `to-issues`) | installed (custom) | break plan into tracer-bullet slices, each with blocked-by edges |
| implement | `implement` | installed (custom) | prompt Constraints: edit only Files, verify gate, commit before DONE |
| fix-review | `tdd` | installed (personal) | red-green-refactor: failing test first, then fix; re-run verify |
| review | `code-review` agent type (built-in) | built-in | Copilot `code-review` agent type; Matt's `code-review` skill optional |
| any bug-fix task | `diagnosing-bugs` | installed (personal) | reproduce → minimise → hypothesise → instrument → fix |
| design seams | `codebase-design`, `domain-modeling` | installed (personal) | model-invoked; workers lean on them for module/seam decisions |

## Copilot adaptation (why no fork is needed)

Matt's skills are written for Claude Code / Cursor. Three traits look
Copilot-incompatible but are handled entirely at the orchestration layer:

1. **`disable-model-invocation: true`** in `to-spec` / `to-tickets` / `implement`.
   This only blocks *implicit* auto-triggering. Workers invoke the skill **explicitly**
   via the `skill` tool from their `Discipline:` line, and the inline `Constraints`
   are a full fallback if invocation is ever suppressed. No edit required.

2. **Slash-commands** (`/tdd`, `/review`, `/setup-matt-pocock-skills`). Copilot follows
   `/skill-name` as "invoke that skill". The prompts remap them explicitly:
   `/tdd` → skill `tdd`; `/review` → the orchestrator's separate `code-review` worker
   (implement stops **before** review); `/setup-matt-pocock-skills` → **skipped**.

3. **Publish + interactive steps.** `to-spec` and `to-tickets` publish to a project
   issue tracker and require an issue-tracker/label setup; both also pause to
   "check with"/"quiz" the user. Background workers can do neither. The `prd` / `issues`
   `Discipline:` lines override these: **do not publish, do not require setup, do not
   interview** — emit the PRD / issue bodies, the frontier confirms with the user, and
   the orchestrator publishes via a `gh` shell worker (or writes `.scratch/<feature>/…`).

## Installing the disciplines

The three that ship outside the default Copilot personal set — `implement`, `to-spec`,
`to-tickets` — are installed as **custom skills** (directory references), so a `git pull`
of the source updates their content with no re-install. Use the bundled updater below;
it does the `copilot skill add` for you. To install by hand instead:

```powershell
# from a checkout of mattpocock/skills main (see the updater below)
copilot skill add <src>/skills/engineering/implement
copilot skill add <src>/skills/engineering/to-spec
copilot skill add <src>/skills/engineering/to-tickets
copilot skill list        # confirm they appear under "Custom skills"
```

`grilling`, `tdd`, `codebase-design`, `domain-modeling`, and `diagnosing-bugs` are
already present in most Copilot setups (personal skills); `code-review` is a built-in
Copilot **agent type**, so no skill is needed for it.

## Updating the disciplines

`mattpocock/skills` evolves (changesets + CHANGELOG). Keep the disciplines current with
the bundled updater, which clones/pulls upstream `main` into a portable cache and
registers the three custom skills:

```powershell
scripts/update-disciplines.ps1        # Windows / PowerShell
```
```bash
scripts/update-disciplines.sh         # macOS / Linux
```

Because the three are registered as **directory references** to the cache, the weekly
pull is enough to refresh their content. A Copilot scheduled workflow can run the
updater automatically (weekly) — see the repo README.
