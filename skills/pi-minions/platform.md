# Pi adapter

Use the Pi minions tools only. Call `minions_start` once with variant `standard`, then
use `minions_spawn`, `minions_read`, `minions_steer`, `minions_resume`,
`minions_stop`, and `minions_close`. The extension owns Provider Affinity, Role
Routing, Minions budgets, and board identity. The installed `pi-subagents` package
owns process lifecycle, persistence, FleetView, work artifacts, supervisor
communication, timeouts, and completion notifications.

Never pass a provider. Pass `modelOverride` only when the user explicitly requested a
model. Use the documented `routeOverride` values for mechanical judgment and the
escalation ladder. After spawning background work, end the turn immediately and do
not poll `minions_read`. After a completion notification, read the worker result,
update the board, and dispatch newly unblocked work. Never exceed six in-flight workers.
The extension also enforces twelve launches and rejects new dispatch after the
eighth result has been read and triaged.

Inside Pi, this adapter takes precedence over the Codex adapter discovered from
`~/.agents/skills`. Workers never interview the user; they return
`STATUS: NEEDS_USER_INPUT`.

Implementer and architect tasks must pass an absolute linked-worktree `cwd`; the
adapter rejects the primary checkout. A failed or paused package run may be revived
with `minions_resume` while keeping the same Minions worker ID. A worker deliberately
stopped with `minions_stop` is not resumable. Generic `pi-subagents` completion
notifications are signals to call `minions_read`; do not bypass the adapter with the
generic `subagent` tool for top-level dispatch.
