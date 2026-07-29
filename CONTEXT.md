# Minion Orchestration

This context defines the language used to coordinate frontier and worker sessions across supported agent platforms and model providers.

## Language

**Active Worker**:
A worker currently executing within an orchestration run. Terminal workers are excluded from the active worker view but remain part of the run's cumulative usage.
_Avoid_: Active subagent, visible worker

**Orchestration Run**:
A single coordinated lifecycle owned by one parent session, with a fixed variant and Provider Affinity. Only one may be active in a parent session at a time.
_Avoid_: Session, batch

**Provider Affinity**:
The provider selected by the parent session when an orchestration run starts. Every frontier, worker, and child session in that run must use that provider, while each role may select a different model offered by it.
_Avoid_: Provider inheritance, same-model policy

**Role Routing**:
The fixed mapping from orchestration roles to model IDs and reasoning levels. Provider selection qualifies that existing mapping but must not alter it.
_Avoid_: Dynamic model selection, provider-specific model matrix

**Session Usage**:
The cumulative token usage and cost of the parent session and every worker in its orchestration runs, including active and terminal workers.
_Avoid_: Parent usage, worker subtotal, main-session usage
