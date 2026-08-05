# Worktrees

Create one linked **Git worktree directory** per write task. Parallel writers never
share a checkout. The Pi runtime canonicalizes each writer path and holds an exclusive
lease until terminal worker proof; `stopping` and provisional Paseo failures keep the
lease. Never reuse a writer worktree merely because an error notification arrived.
Under Paseo this never means creating another Paseo Workspace:
all workers are native child agents in the caller's existing Workspace, and the
absolute Git worktree path is passed to `minions_spawn` as `cwd`. Never call Paseo
`create_workspace` for Minions isolation.

Under Orca, writer isolation must also be Orca-managed so the native worker terminal
can be placed there. Have a mechanical preparation task run `orca worktree create`
with the required base and return the created absolute path; pass that path as `cwd`.
Do not use raw `git worktree add` for an Orca-native writer and do not create a second
agent terminal while preparing the worktree. Read-only workers may use the current
Orca-managed worktree.

Spawn only unblocked tasks. An independent task branches from the remote default
branch. A dependent task branches from the completed blocker's local branch.

```text
# Ordinary Pi
git worktree add .worktrees/<slug> -b <slug> origin/<default-branch>
git worktree add .worktrees/<slug> -b <slug> <blocker-branch>

# Orca-hosted Pi
orca worktree create --name <slug> --base-branch origin/<default-branch> --json
orca worktree create --name <slug> --base-branch <blocker-branch> --json
```

Use lowercase hyphenated slugs. Record absolute worktree, branch, base SHA, and
`based-on:` in the board.

Every worker preflights its scope:

```text
pwd
git branch --show-current
git rev-parse HEAD
```

All later git and shell calls stay scoped to that worktree. Implementers commit before
`DONE`; fix-review leaves changes uncommitted for the final mechanical commit.

After close, ask the user to choose either dependency-ordered merge or stacked PRs,
then delegate landing to mechanical workers.

