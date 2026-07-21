# Worker prompts

Spawn templates for the Copilot `task` tool. Pin `model` per [`models.md`](models.md).
Every spawn: `mode: "background"`. Pass each block as the `task` `prompt`; set
`agent_type`, `model`, and (where supported) `reasoning_effort` on the tool call.

> Cursor→Copilot: `subagent_type` → `agent_type`; `run_in_background: true` →
> `mode: "background"`; `Shell working_directory` → `powershell` command run with
> the worktree cwd (or `git -C <abs>`).

**Disciplines.** Worker *behaviour* comes from discipline skills
([`disciplines.md`](disciplines.md)). Where a template has a `Discipline:` line,
the worker loads that skill if available (invoke the `skill` tool with the name),
otherwise follows the inline `Constraints` as fallback.

**Global rule — workers never talk to the user (applies to every template below).**
A spawned worker is a background agent. It **must not** call `ask_user`, open
interactive prompts, or wait for human input — in the app those land in an ephemeral
agent tab the user cannot reliably reopen, so the question gets lost. When a worker
needs a human decision it **stops and returns `STATUS: NEEDS_USER_INPUT`** with a
one-line question. Only the **frontier** (stable main thread) relays that question to
the user via `ask_user`, then respawns the worker with the answer folded into `Spec`.
If a discipline skill says "check with the user" / "interview" / "quiz", that step is
**overridden** to STATUS surfacing.

## explore

Delegated repo facts. `agent_type: explore`, model `kimi-k2.7-code`.

```
Task ID: <id>
Type: explore

Working directory (absolute):
<repo root or worktree path>

Question:
<specific question — not "map entire repo">

Scope (optional):
- <paths>

Constraints:
- Read-only
- Scoped: run shell/git with cwd = path above (worktrees.md Scoped cwd)
- Answer only; <=30 lines
- Never call ask_user / interactive prompts — a human decision → STATUS: NEEDS_USER_INPUT (one-line question) to the frontier

Output:
<=15 lines. Summary + STATUS line only — no tables, no markdown essays.
STATUS: DONE | NEEDS_USER_INPUT | BLOCKED
```

## implement

`agent_type: general-purpose`, model per [`models.md`](models.md).

```
Task ID: <id>
Type: implement
Discipline: load skill `implement` if available (invoke the skill tool with "implement");
  else follow Constraints below. Copilot mapping: the skill's `/tdd` → skill `tdd`;
  its `/review` step is SKIPPED here — the orchestrator runs review as a separate
  worker (stop before review). Design seams → lean on `codebase-design` /
  `domain-modeling` if present.

Spec:
<issue or excerpt — <=15 lines>

Files:
- <paths>

Issue: <#123 title, if any>

Working directory (absolute):
<worktree path — required>

Constraints:
- Scoped: every shell/git call uses cwd = path above; preflight pwd/branch/HEAD (worktrees.md Scoped cwd)
- Edit only Files (+ direct imports/callers)
- Context beyond Files → at most ONE explore (kimi-k2.7-code), then edit
- Max 1 explore per task
- Verify gate: lint / test / typecheck must pass before DONE — not done until verify passes
- Commit before DONE — git add task files, conventional message referencing issue ID. Do not push.
- Stop before review — orchestrator spawns review; do not self-review
- Insufficient context → STATUS: NEEDS_CONTEXT (one line)
- Never call ask_user / interactive prompts — a human decision (unclear requirement, seam ambiguity) → STATUS: NEEDS_USER_INPUT (one-line question) to the frontier; do not guess and do not block silently

Output:
One line: commit SHA + message, verify one-liner, diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | NEEDS_USER_INPUT | BLOCKED
```

## review

`agent_type: code-review`, model `claude-opus-4.8`.

```
Task ID: <id>
Type: review
Discipline: Copilot `code-review` agent type (built-in). Also load skill
  `code-review` if installed.

Fixed point: <SHA>
Spec: <acceptance criteria for this task only>
Commits since fixed: <from implementer git log>
Verify result: <one line>

Worktree (absolute):
<worktree path>

Constraints:
- Scoped: all git runs with cwd = worktree path (worktrees.md Scoped cwd)
- Do not run lint / test / typecheck — implementer passed the verify gate; Verify result is informational only (models.md)
- Diff committed work:
  - git diff <fixed-point>...HEAD  and  git log <fixed-point>..HEAD --oneline
- If git diff HEAD --stat is non-empty (fix-review round): also review git diff HEAD

Preflight (mandatory, in order — stop on first failure):
1. cwd = worktree path; pwd; git branch --show-current
2. git rev-parse <fixed-point>
3. git log <fixed-point>..HEAD --oneline  OR  git diff HEAD --stat — at least one non-empty
4. If step 3 empty: re-run once with cwd set; if still empty → STATUS: BLOCKED (one line: cwd, branch, fixed point)
5. Do not search other branches, reflog, other worktrees, parent repos, or grep for feature terms to "find" the diff

Output:
STATUS line first. If REVIEW_CHANGES_REQUIRED: one blocking bullet per issue under Changes: — no prose essay.
STATUS: REVIEW_APPROVED | REVIEW_CHANGES_REQUIRED | BLOCKED
Changes:
1. ...
```

## fix-review

`agent_type: general-purpose`, same tier as implement.

```
Task ID: <id>
Type: fix-review
Discipline: load skill `tdd` if available (red-green-refactor); else follow
  Constraints below.

Changes:
<verbatim from reviewer>

Working directory (absolute):
<worktree path>

Constraints:
- Scoped: every shell/git call uses cwd = path above (worktrees.md Scoped cwd)
- Edit only reviewer files (+ direct fixes)
- Fallback (no `tdd` skill): reproduce the issue with a failing test first, then fix
  until green; do not delete tests to pass
- Verify gate: re-run lint / test / typecheck before DONE
- Do not commit — the post-review commit handles it

Output:
One line: verify result + git diff HEAD --stat.
STATUS: DONE | BLOCKED
```

## commit

Post-review — **second commit**. Runs after `REVIEW_APPROVED`.
`agent_type: task`, model `kimi-k2.7-code`.

```
Task ID: <id>
Type: commit

Fixed point: <SHA>
Issue: <#123, if any>

Working directory (absolute):
<worktree path>

Commit fix-review changes — git add task files + conventional message referencing issue ID.
If the working tree is clean after approval: STATUS: DONE with final SHA (implement commit stands).
Do not push unless the spec says to.

Constraints:
- Scoped: every shell/git call uses cwd = path above (worktrees.md Scoped cwd)

Output:
Commit SHA (or "unchanged" + HEAD SHA).
STATUS: DONE
```

## shell

`agent_type: task`, model `kimi-k2.7-code` (or `gpt-5.6-terra` high for judgment).

```
Task ID: <id>
Type: shell

Working directory (absolute):
<repo root or worktree>

Spec:
<exact goal>

Commands (if known):
- <ordered list, or "figure out commands">

Constraints:
- Scoped: every shell/git call uses cwd = path above (worktrees.md Scoped cwd)
- Do not edit source unless spec says (e.g. conflict resolution)
- Do not push / open PRs unless spec says
- Never call ask_user / interactive prompts — a human decision → STATUS: NEEDS_USER_INPUT (one-line question) to the frontier

Output:
<=5 lines: outcome + key command output. No diagnostic essays.
STATUS: DONE | NEEDS_USER_INPUT | BLOCKED
```

## worktree-setup

Runs from the **repo root** (not the new worktree). Subsequent spawns use the
worktree absolute path. `agent_type: task`, model `kimi-k2.7-code`.

```
Task ID: <id>
Type: worktree-setup

Working directory (absolute):
<repo root>

Branch name: <slug>
Base ref: <origin/<base-branch> | <blocker-branch> — see worktrees.md Dependencies>

Commands:
git fetch origin
git worktree add .worktrees/<slug> -b <slug> <Base ref>

Constraints:
- Scoped: run with cwd = repo root above

Output:
Worktree path, branch, base SHA — one line each.
STATUS: DONE | BLOCKED
```

## prd

`agent_type: general-purpose`, model `gpt-5.6-terra` high.

```
Task ID: <id>
Type: prd
Discipline: load skill `to-spec` if available (invoke the skill tool with "to-spec";
  older installs may name it "to-prd"); else synthesize inline per Constraints. Copilot overrides to the skill's own steps:
  do NOT run `/setup-matt-pocock-skills`, do NOT publish to an issue tracker, and do
  NOT "check with the user" — you are a background worker. Emit the PRD; the frontier
  confirms seams with the user and the orchestrator publishes.

Context:
<grilling decisions, constraints — structured brief, not chat dump>

Explore summary:
<from explore worker, or "none">

Seams (if pre-agreed):
<list, or "propose assumptions">

Constraints:
- Synthesize — do not interview the user
- Do not publish; do not require setup-matt-pocock-skills
- Unclear seams → STATUS: NEEDS_USER_INPUT

Output:
Full PRD markdown.
STATUS: DONE | NEEDS_USER_INPUT
```

## issues

`agent_type: general-purpose`, model `gpt-5.6-terra` high.

```
Task ID: <id>
Type: issues
Discipline: load skill `to-tickets` if available (invoke the skill tool with "to-tickets";
  older installs may name it "to-issues"); else slice inline per Constraints. Copilot overrides to the skill's own steps: do NOT
  run `/setup-matt-pocock-skills`, do NOT publish issues, and do NOT "quiz the user" —
  you are a background worker. Emit the slices + issue bodies; the frontier confirms
  granularity with the user and the orchestrator publishes via a `gh` shell worker.

Approved plan:
<PRD or spec>

Explore summary:
<optional>

Constraints:
- Draft tracer-bullet slices + issue bodies — do not publish; do not require setup-matt-pocock-skills
- Do not quiz the user; the frontier confirms
- Skip publish

Output:
Numbered slices (title, blocked-by, stories) + issue body each.
STATUS: DONE | NEEDS_USER_INPUT
```
