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
Review lineage: <stable ID and cumulative round>
Spec: <frozen acceptance criteria>
Review ledger: <prior root findings, fix commits, and regression tests or none>
Verify result: <one line>
Working directory: <absolute worktree>

Constraints:
- Read-only and scoped to the worktree.
- Confirm fixed point, clean tree, and non-empty committed diff.
- Review git diff <fixed>...HEAD and commits since <fixed>.
- Do not stop after the first blocker; complete the bounded review.
- Group affected sibling paths under their shared violated invariant.
- Classify each root finding as introduced regression, incomplete implementation/fix,
  pre-existing defect, or out-of-scope hardening. Only the first two plus explicit frozen security
  invariants may block; route the rest to Landing tasks.
- Trace every blocker to the frozen Spec, concrete code, and a reproducer or missing test.
- Verify every prior ledger entry and inspect equivalent sibling paths for recurrence.
- Do not rerun lint, tests, or typecheck.

Output:
STATUS: REVIEW_APPROVED | REVIEW_CHANGES_REQUIRED | BLOCKED
Root findings:
1. Invariant: <name>; class: <classification>; evidence: <file/reproducer>;
   affected sibling paths: <complete list>; required closure: <observable result>
Landing tasks:
1. <non-blocking hardening or none>
```

## Integrated review

Use after reconciling pre-existing branches and again before landing a stacked change.

```text
Task ID: <id>
Role: reviewer
Discipline: load code-review if available.
Fixed point: <remote default or issue baseline SHA>
Integrated HEAD: <SHA>
Review lineage: <stable ID and cumulative round>
Spec: <frozen complete issue acceptance criteria>
Review ledger: <prior root findings and fix commits or none>
Inputs: <branches and commits reconciled>
Verify result: <one line, including skipped required integrations>
Working directory: <absolute worktree>

Constraints:
- Read-only and scoped to the worktree; confirm a clean cumulative committed diff.
- Review git diff <fixed>...<integrated HEAD>, not only the latest slice.
- Do not stop after the first blocker; trace every acceptance criterion to code/tests.
- Group sibling defects by root invariant and inspect every equivalent producer,
  consumer, mutation, rollback, and serialization path before returning.
- Classify findings and trace blockers to the frozen Spec or an explicit security
  invariant. Pre-existing defects and extra hardening are Landing tasks.
- Verify prior ledger entries and cross-slice interactions.
- Do not rerun lint, tests, or typecheck.

Output:
STATUS: REVIEW_APPROVED | REVIEW_CHANGES_REQUIRED | BLOCKED
Root findings:
1. Invariant: <name>; class: <classification>; evidence: <file/reproducer>;
   affected sibling paths: <complete list>; required closure: <observable result>
Landing tasks:
1. <non-blocking follow-up or none>
```

## Fix review

```text
Task ID: <id>
Role: implementer | architect
Discipline: load tdd if available.
Current HEAD: <clean SHA>
Review lineage: <stable ID and cumulative round>
Root findings: <verbatim unresolved consolidated findings>
Review ledger: <prior findings, checkpoint commits, and regression tests>
Preserved invariants: <compact cumulative invariants>
Regression matrix: <mandatory redesign matrix after the second negative review>
Slice growth: <original ownership/diff versus proposed repair>
Verify delta: <focused regression and affected shards>
Working directory: <absolute worktree>

Constraints:
- Reproduce each root finding with a failing test where practical.
- On the first repair, fix only the findings and direct consequences.
- After the second negative review, freeze edits until the architect has consolidated
  every finding, inspected sibling paths, completed the matrix, and confirmed the slice
  still fits its growth budget. Otherwise return `NEEDS_USER_INPUT` with re-slice options.
- Run the focused verify delta; the canonical gate runs after final approval. A changed
  contract, subsystem seam, or baseline requires the canonical gate now.
- Commit the repair as one local checkpoint commit; never push or self-review.
- Save full logs outside the repository; return only failure excerpts and final summary.

Output: checkpoint commit SHA, verify result, ledger delta, and diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_USER_INPUT | BLOCKED
```

## Architect continuation

Resume a completed `architecture-owner` only for the same Goal, Spec, fixed point, and
worktree. The follow-up message is a compact delta:

```text
Task ID: <id>
Role: architect continuation
Current HEAD: <clean SHA>
Review lineage: <stable ID and cumulative round>
Root findings: <verbatim new consolidated reviewer findings>
Review ledger: <prior findings, checkpoint commits, and regression tests>
Cumulative invariants: <unresolved and previously fixed invariants>
Regression matrix: <complete new and retained adversarial cases>
Slice growth: <original ownership/diff versus proposed repair>
Verify delta: <focused commands; canonical contract remains in retained context>

Constraints:
- This is the worker's only allowed continuation; inspect the committed lineage first.
- Before editing, consolidate root invariants and inspect all sibling paths.
- Stop with re-slice options if the repair exceeds the recorded growth budget.
- Reproduce each new issue with a failing test where practical.
- Fix only the findings and direct consequences.
- Commit one local checkpoint; do not push or self-review. A fresh review follows.

Output: checkpoint commit SHA, design delta, verify result, ledger delta, and diff stat.
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
