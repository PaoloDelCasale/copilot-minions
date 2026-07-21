# Pi workers use RPC subprocesses

Pi orchestration runs each worker as an ephemeral `pi --mode rpc --no-session` subprocess instead of an in-process SDK session. This preserves Provider Affinity while allowing role-specific models, and provides isolated context, failures, cancellation, and steering; the shared Pi extension accepts the added process-lifecycle complexity and prevents session replacement while workers are active to avoid orphaned processes.
