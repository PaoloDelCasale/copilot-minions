# Shell and CLI

The frontier delegates every CLI operation to role `mechanical`.

| Category | Examples |
|----------|----------|
| Git | fetch, worktree, merge, push, status, log, diff |
| GitHub | `gh` PR, issue, checks, and API operations |
| Package managers | npm, pnpm, pip, cargo when the spec requires |
| Scripts | repository-provided build and maintenance scripts |

Every command runs with the task's absolute working directory. Prefer a native
working-directory option; otherwise use scoped commands such as `git -C <path>`.
Commit is a separate mechanical prompt, not an incidental implementer action.
Exploration is read-only and uses role `explorer`.

