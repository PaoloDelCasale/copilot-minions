# Pi workers use RPC subprocesses

Pi orchestration runs each worker as an ephemeral `pi --mode rpc --no-session` subprocess instead of an in-process SDK session. This preserves Provider Affinity while allowing role-specific models, and provides isolated context, failures, cancellation, and steering; the shared Pi extension accepts the added process-lifecycle complexity and prevents session replacement while workers are active to avoid orphaned processes.

The subprocess session is not persisted or resumable. The parent extension persists lifecycle snapshots for diagnostics, while the worker widget renders only live processes. Reload-interrupted workers are reported by notification but are not rendered as active or treated as resumable. Usage is accounted exactly once during the normal read/close lifecycle; abrupt shutdown or reload can leave uncredited worker usage in diagnostics because Pi's shutdown event cannot contribute usage to native session totals.
