# Pi low-budget adapter

Use the Pi minions tools only. Call `minions_start` once with variant `lb`, then use
`minions_spawn`, `minions_read`, `minions_steer`, `minions_stop`, and
`minions_close`. The extension owns Provider Affinity, Role Routing, concurrency,
process lifecycle, and completion notifications.

Never pass a provider. Pass `modelOverride` only when the user explicitly requested a
model. Use the documented `routeOverride` values for mechanical judgment and the LB
escalation ladder. After a completion notification, read the worker result, update the
board, and dispatch newly unblocked work. Never exceed six in-flight workers.

Inside Pi, this adapter takes precedence over the Codex adapter discovered from
`~/.agents/skills`. Workers never interview the user; they return
`STATUS: NEEDS_USER_INPUT`.
