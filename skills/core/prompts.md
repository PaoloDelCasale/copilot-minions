# Worker prompts

The platform adapter maps each semantic `Role` to a native agent. Keep spawn specs at
most 15 lines before the Constraints section. Workers never ask the user or wait for
interactive input; they return `STATUS: NEEDS_USER_INPUT` with one question.

## Explorer

```text
Task ID: <id>
Role: explorer
Working directory: <absolute path>
Question: <one bounded repository question>
Scope: <paths>

Constraints:
- Read-only.
- Keep every command scoped to the working directory.
- Do not propose unrelated fixes.
- Human decision -> STATUS: NEEDS_USER_INPUT.

Output: summary <=15 lines.
STATUS: DONE | NEEDS_USER_INPUT | BLOCKED
```

## Implement

```text
Task ID: <id>
Role: implementer | architect
Discipline: load implement if available; stop before its review step.
Spec: <acceptance criteria>
Files: <paths>
Issue: <reference or none>
Working directory: <absolute worktree>
Verify contract: <canonical commands, environment, required integrations>

Constraints:
- Preflight cwd, branch, and HEAD.
- Edit only Files and direct imports/callers.
- Use at most one explorer for missing cross-module context.
- Run the repository's lint, test, and typecheck gate.
- Keep full command logs outside the repository; return only failures and final summaries.
- Commit task files before DONE; do not push.
- Do not self-review.
- Human decision -> STATUS: NEEDS_USER_INPUT.
- Missing repository fact -> STATUS: NEEDS_CONTEXT.

Output: commit SHA, message, verify one-liner, diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | NEEDS_USER_INPUT | BLOCKED
```

### Architect preflight

For role `architect`, require this analysis before editing:

- enumerate preserved invariants and explicit compatibility seams;
- map lock, transaction, validation/use, rollback, and restart-recovery boundaries;
- identify failures before, during, and after each durable mutation;
- build adversarial regression cases for concurrency, stale state, and partial failure;
- prefer the smallest design that closes the matrix without broadening the Spec.

Record the architect worker ID as `architecture-owner` for its slice. This preflight
is implementation reasoning, not self-review; the later reviewer must still be fresh.

## Review

```text
Task ID: <id>
Role: reviewer
Discipline: load code-review if available.
Fixed point: <SHA>
Spec: <acceptance criteria>
Verify result: <one line>
Working directory: <absolute worktree>

Constraints:
- Read-only and scoped to the worktree.
- Confirm fixed point and non-empty committed diff.
- Review git diff <fixed>...HEAD and commits since <fixed>.
- If fix-review changes are uncommitted, also review git diff HEAD.
- Do not rerun lint, tests, or typecheck.
- Report only correctness, security, regression, or missing-test blockers.

Output:
STATUS: REVIEW_APPROVED | REVIEW_CHANGES_REQUIRED | BLOCKED
Changes:
1. <blocking finding with file reference>
```

## Integrated review

Use after reconciling pre-existing branches and again before landing a stacked change.

```text
Task ID: <id>
Role: reviewer
Discipline: load code-review if available.
Fixed point: <remote default or issue baseline SHA>
Integrated HEAD: <SHA>
Spec: <complete issue acceptance criteria>
Inputs: <branches and commits reconciled>
Verify result: <one line, including skipped required integrations>
Working directory: <absolute worktree>

Constraints:
- Read-only and scoped to the worktree.
- Confirm the fixed point and cumulative committed diff.
- Review git diff <fixed>...<integrated HEAD>, not only the latest slice.
- Trace every acceptance criterion to code and tests.
- Check migrations, authorization invariants, compatibility, rollback, and
  cross-slice interactions.
- Do not rerun lint, tests, or typecheck.
- Put only correctness/security/regression/test blockers under Changes; report
  publication or issue-tracker work separately as Landing tasks.

Output:
STATUS: REVIEW_APPROVED | REVIEW_CHANGES_REQUIRED | BLOCKED
Changes:
1. <blocking finding with file reference>
Landing tasks:
1. <non-code follow-up or none>
```

## Fix review

```text
Task ID: <id>
Role: implementer | architect
Discipline: load tdd if available.
Current HEAD: <SHA and dirty/clean state>
Changes: <verbatim unresolved reviewer findings>
Preserved invariants: <compact cumulative invariants>
Regression matrix: <required after the second changes-required result, otherwise none>
Verify delta: <focused commands; canonical contract remains authoritative>
Working directory: <absolute worktree>

Constraints:
- Reproduce each issue with a failing test where practical.
- After the second changes-required result, use role `architect` and cover every
  invariant in the regression matrix before editing.
- Fix only reviewer findings and direct consequences.
- Rerun the verify contract; required skipped integrations are concerns, not passes.
- Save full logs outside the repository; return only failure excerpts and the final summary.
- Do not commit; final commit is a separate worker.

Output: verify result and diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED
```

## Architect continuation

Resume a completed `architecture-owner` only for the same Goal, Spec, fixed point, and
worktree. The follow-up message is a compact delta:

```text
Task ID: <id>
Role: architect continuation
Current HEAD: <SHA and dirty/clean state>
Changes: <verbatim new reviewer findings>
Cumulative invariants: <unresolved and previously fixed invariants>
Regression matrix: <new and retained adversarial cases>
Verify delta: <focused commands; canonical contract remains in retained context>

Constraints:
- This is the worker's only allowed continuation; inspect the current diff and finding locations first.
- Reproduce each new issue with a failing test where practical.
- Fix only the findings and direct consequences.
- Do not self-review or commit; a fresh review and mechanical commit follow.

Output: design delta, verify result, diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED
```

Do not use an architect continuation for environment repair, assertion-only changes
against an established contract, a changed specification, or a different worktree.

## Commit

```text
Task ID: <id>
Role: mechanical
Fixed point: <SHA>
Issue: <reference or none>
Working directory: <absolute worktree>

Commit review fixes with a conventional message. If clean, report unchanged HEAD.
Do not push.

STATUS: DONE | BLOCKED
```

## Shell

```text
Task ID: <id>
Role: mechanical
Working directory: <absolute path>
Spec: <exact command outcome>
Commands: <ordered commands or discover them>

Constraints:
- Keep every command scoped to the working directory.
- Do not edit source unless explicitly requested.
- Do not push or publish unless explicitly requested.
- Human decision -> STATUS: NEEDS_USER_INPUT.

Output: outcome <=5 lines.
STATUS: DONE | NEEDS_USER_INPUT | BLOCKED
```

## Verify contract discovery

```text
Task ID: <id>
Role: mechanical
Working directory: <absolute repository or worktree>
Spec: Discover the canonical verification contract without changing the environment.

Constraints:
- Read repository instructions and existing configuration.
- Identify interpreter/runtime, exact lint/test/typecheck commands, required external
  integrations, expected duration, and deterministic sharding if timeout is likely.
- Do not install dependencies or edit files.
- Distinguish required checks from optional checks and pre-existing baseline failures.

Output: one reusable verify contract <=10 lines.
STATUS: DONE | BLOCKED
```

## Worktree setup

```text
Task ID: <id>
Role: mechanical
Working directory: <repository root>
Branch: <slug>
Base ref: <remote default or blocker branch>

Create .worktrees/<slug>, then report absolute path, branch, and base SHA.
STATUS: DONE | BLOCKED
```

## PRD

```text
Task ID: <id>
Role: planner
Discipline: load to-spec (legacy to-prd) if available.
Context: <confirmed decisions>
Explore summary: <facts or none>
Seams: <confirmed seams or assumptions to surface>

Constraints:
- Synthesize; do not interview.
- Do not publish or run setup commands.
- Unclear product decision -> STATUS: NEEDS_USER_INPUT.

Output: full PRD markdown.
STATUS: DONE | NEEDS_USER_INPUT
```

## Issues

```text
Task ID: <id>
Role: planner
Discipline: load to-tickets (legacy to-issues) if available.
Approved plan: <PRD>
Explore summary: <facts or none>

Constraints:
- Draft tracer-bullet slices, dependencies, and issue bodies.
- Do not interview or publish.

Output: numbered slices and issue bodies.
STATUS: DONE | NEEDS_USER_INPUT
```
