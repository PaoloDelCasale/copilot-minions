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
Every child remains in the caller's existing Paseo Workspace. Never create a Paseo
Workspace for a Minions worker. When Pi runs in an Orca agent terminal, the extension
uses Orca's native Run/Task/Dispatch and terminal lifecycle through the public `orca`
CLI. Workers are visible as supervised Orca workers and run in the Orca-managed
worktree selected by `cwd`; ordinary `pi-subagents` is not used.

Never pass a provider. Normal dispatch omits `modelOverride`, `routeOverride`,
`overrideReason`, and `overrideFromWorkerId`. Pass `modelOverride` only when the user
explicitly requested that exact model for the next batch; the runtime audits and
downgrades any unauthorized value to role routing. A named route must carry the structured judgment or
prior-worker evidence required by [`control.md`](control.md); complexity alone never
qualifies. Invalid named overrides are audited and downgraded to the normal role route
so a frontier cannot evade routing by changing worker roles after a rejected spawn.
After spawning background work, end the turn immediately and do not poll
`minions_read`. After a completion notification, read the worker result,
update the board, and dispatch newly unblocked work. Never exceed six in-flight workers.
The extension also enforces thirty launches. After eight triaged results it accepts
only already-boarded closure work whose spawn sets `budgetClass: "closure"`; after
thirty results it rejects every new dispatch.

Inside Pi, this adapter takes precedence over the Codex adapter discovered from
`~/.agents/skills`. Workers never interview the user; they return
`STATUS: NEEDS_USER_INPUT`.

Implementer and architect tasks must pass an absolute linked-worktree `cwd`; the
adapter rejects the primary checkout. Under Orca that path must also be an
Orca-managed worktree; prepare it with `orca worktree create` rather than raw
`git worktree add`. A paused, failed, or completed package run may
be revived with `minions_resume` while keeping the same Minions worker ID. Use this
for a same-slice architecture owner only while Goal, Spec, fixed point, worktree, and
budget eligibility remain unchanged. A worker deliberately stopped with
`minions_stop` is not resumable. Paseo, Orca, and generic `pi-subagents`
completion notifications are signals to call `minions_read`; do not bypass the
adapter with generic `subagent`, MCP `create_agent`, `send_agent_prompt`,
`create_workspace`, or direct Orca terminal/Dispatch lifecycle commands for top-level
dispatch. In particular, a linked Git worktree passed as `cwd` is write isolation
inside the existing Paseo Workspace, not a request to create another Workspace.
Paseo and Orca do not expose a package-owned persistent child deadline through this
adapter, so omit `timeoutSeconds` for native workers and use `maxDurationSeconds` for
the Minions watchdog. The runtime ignores and reports an accidental native-host
`timeoutSeconds` value; it never lets that ordinary-Pi field shorten the watchdog.
Treat that warning as a payload bug and omit the field on the next spawn, rather than
retrying the worker or changing its role. Orca currently reports duration and terminal
lifecycle but not normalized token/cost usage, so its watchdog enforces duration while
Orca owns worker visibility and output archives. Omit `modelOverride`
entirely unless raw user input explicitly requested that exact model for the next
batch; never pass an empty string.
