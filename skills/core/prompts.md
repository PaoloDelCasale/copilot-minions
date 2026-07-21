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

Constraints:
- Preflight cwd, branch, and HEAD.
- Edit only Files and direct imports/callers.
- Use at most one explorer for missing cross-module context.
- Run the repository's lint, test, and typecheck gate.
- Commit task files before DONE; do not push.
- Do not self-review.
- Human decision -> STATUS: NEEDS_USER_INPUT.
- Missing repository fact -> STATUS: NEEDS_CONTEXT.

Output: commit SHA, message, verify one-liner, diff stat.
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | NEEDS_USER_INPUT | BLOCKED
```

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

## Fix review

```text
Task ID: <id>
Role: implementer | architect
Discipline: load tdd if available.
Changes: <verbatim reviewer findings>
Working directory: <absolute worktree>

Constraints:
- Reproduce each issue with a failing test where practical.
- Fix only reviewer findings and direct consequences.
- Rerun the verify gate.
- Do not commit; final commit is a separate worker.

Output: verify result and diff stat.
STATUS: DONE | BLOCKED
```

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
