# Orca-hosted Pi uses Orca native orchestration

## Status

Accepted for the Orca integration.

## Context

The ordinary Pi adapter delegates worker lifecycle to `pi-subagents` RPC v1. When Pi
runs inside an Orca-managed terminal, those package-owned subprocesses are not native
Orca Tasks or Dispatches and do not appear in Orca's supervised worker accounting.
Orca exposes a public CLI backed by its running runtime, including Run, Task,
Dispatch, terminal, worktree, status, stop, follow-up, and output-archive operations.
Orca injects an authenticated terminal/worktree identity through `ORCA_*` environment
variables.

Minions must preserve provider affinity and exact model/thinking routes. Orca's
high-level `worker-start --agent pi` launcher does not accept a Pi model route, while
the supported low-level composition permits a custom Pi command followed by an
injected native Dispatch.

## Decision

Add an `orca` adapter behind the existing `minions_*` runtime seam. Select it only
when the Pi process has a complete Orca agent identity (`ORCA_TERMINAL_HANDLE`,
`ORCA_WORKTREE_ID`, hook endpoint, and hook contract version 1). A partial Orca
identity fails closed instead of falling back to invisible `pi-subagents` workers.
Paseo detection remains higher priority if both host identities are present.

At `minions_start`, the adapter validates Orca readiness and the
`orchestration.contract.v1` capability, then creates a native Orca Run bound to the
current coordinator terminal. Reload restores the persisted Run ID and rebinds it.
For every initial worker it:

1. verifies that `cwd` is an Orca-managed worktree;
2. creates a native Orca Task containing the Minions role and assignment contract;
3. creates a background Pi terminal with the exact provider/model/thinking route;
4. waits for the Pi TUI to become ready;
5. injects a native Orca Dispatch so the worker reports `worker_done` through Orca.

The adapter maps the Dispatch ID, terminal handle, and Task ID to one Minions worker.
Status and output come from `worker-show` and `worker-read`; steering uses interrupt
input to the exact worker terminal; stop uses `worker-stop`. Resume creates a fresh
Task and transfers the same terminal to a new Dispatch, preserving both the Pi session
and Minions worker identity. `minions_close` releases settled worker terminals through
`worker-release`, leaving Orca's output archives available.

The existing Minions watchdog polls native status while the parent is idle and wakes
the Pi frontier when a worker becomes terminal. Orca currently does not expose a
normalized token/cost DTO through this CLI surface, so duration ceilings remain
enforced but cost ceilings cannot be evaluated for Orca workers. `timeoutSeconds` is
therefore ignored for Orca just as it is for Paseo; `maxDurationSeconds` is the native
host watchdog field.

Writer paths must be created through `orca worktree create` rather than raw
`git worktree add`, because native Orca terminals can be placed only in Orca-managed
worktrees. Minions still owns writer leases and rejects the primary checkout.

## Consequences

Orca users see Minions workers in Orca's native supervised orchestration state instead
of only in Pi FleetView. Run, Task, Dispatch, terminal, stop, resume, and archived
output identities survive Pi extension reloads. Ordinary Pi and Paseo behavior remain
unchanged.

The adapter intentionally uses the public `orca` CLI rather than importing Orca's
private packaged modules. Runtime capability checks and structured JSON envelopes
provide the compatibility boundary. Authenticated release validation must still cover
parallel dispatch, writer worktree preparation, completion wake-up, steering, stop,
reload, follow-up reuse, terminal release, and output archive readability on Windows,
macOS, Linux, and managed WSL.
