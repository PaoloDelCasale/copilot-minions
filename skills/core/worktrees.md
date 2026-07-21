# Worktrees

Create one worktree per write task. Parallel writers never share a checkout.

Spawn only unblocked tasks. An independent task branches from the remote default
branch. A dependent task branches from the completed blocker's local branch.

```text
git worktree add .worktrees/<slug> -b <slug> origin/<default-branch>
git worktree add .worktrees/<slug> -b <slug> <blocker-branch>
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

