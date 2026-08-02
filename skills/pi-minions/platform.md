# Pi adapter

Use the Pi minions tools only. Call `minions_start` once with variant `standard`, then
use `minions_spawn`, `minions_read`, `minions_steer`, `minions_resume`,
`minions_stop`, and `minions_close`. The extension owns Provider Affinity, Role
Routing, Minions budgets, and board identity. In an ordinary Pi session, the
installed `pi-subagents` package owns process lifecycle, persistence, FleetView,
work artifacts, supervisor communication, timeouts, and completion notifications.
When Pi is hosted by Paseo, the extension instead uses Paseo's injected agent-scoped
MCP: workers become native Paseo child agents visible in its subagent track, and
Paseo owns their persistence, activity, usage, stop, follow-up, and notifications.

Never pass a provider. Pass `modelOverride` only when the user explicitly requested a
model. Use the documented `routeOverride` values for mechanical judgment and the
escalation ladder. After spawning background work, end the turn immediately and do
not poll `minions_read`. After a completion notification, read the worker result,
update the board, and dispatch newly unblocked work. Never exceed six in-flight workers.
The extension also enforces thirty launches. After eight triaged results it accepts
only already-boarded closure work whose spawn sets `budgetClass: "closure"`; after
thirty results it rejects every new dispatch.

Inside Pi, this adapter takes precedence over the Codex adapter discovered from
`~/.agents/skills`. Workers never interview the user; they return
`STATUS: NEEDS_USER_INPUT`.

Implementer and architect tasks must pass an absolute linked-worktree `cwd`; the
adapter rejects the primary checkout. A failed or paused package run may be revived
with `minions_resume` while keeping the same Minions worker ID. A worker deliberately
stopped with `minions_stop` is not resumable. Paseo and generic `pi-subagents`
completion notifications are signals to call `minions_read`; do not bypass the
adapter with the generic `subagent` or Paseo `create_agent` tool for top-level
dispatch. Paseo does not yet expose a persistent deadline through this adapter, so
omit `timeoutSeconds` for Paseo-managed workers.
