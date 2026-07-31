# Pi subagent runtime comparison

Research date: 2026-07-31

## Question

Is [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) the best runtime for Copilot Minions on Pi, or is there a better repository?

## Conclusion

For the current adapter, `nicobailon/pi-subagents` is the best practical choice and the only compatible drop-in found. The adapter already targets its versioned `subagents:rpc:v1` contract, completion event, lifecycle artifact, and `ping`/`status`/`spawn`/`steer`/`stop`/`resume` methods. Replacing it would require a material adapter rewrite and a new release-validation campaign.

It is not unconditionally the most capable Pi orchestration project. If starting from scratch, `@minhduydev/pi-subagents` deserves evaluation for its stronger durable-runtime features, while `@gotgenes/pi-subagents` is the closest behavioral peer. Neither is API-compatible with this checkout.

The current integration should remain beta until authenticated orchestration and resume tests pass with both supported providers.

## Current runtime

[`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) provides persistent child runs, artifacts, recovery, resume, acknowledged steering, stop control, completion events, lifecycle reconciliation, supervisor communication, and FleetView. Its RPC contract is explicitly versioned and capability-checked.

The repository currently pins `npm:pi-subagents@0.37.2`; npm and GitHub reported `0.38.0` as latest on the research date. The package is still pre-1.0, contributor activity is concentrated in its owner, and the local automated suite uses a fake runtime rather than an authenticated host cycle. Popularity and downloads are adoption signals, not proof of correctness.

Primary sources:

- [Repository](https://github.com/nicobailon/pi-subagents)
- [Repository API](https://api.github.com/repos/nicobailon/pi-subagents)
- [v0.37.2 package metadata](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/package.json)
- [RPC implementation](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/extension/rpc.ts)
- [Resume implementation](https://github.com/nicobailon/pi-subagents/blob/v0.37.2/src/runs/background/async-resume.ts)
- [v0.37.2 release](https://github.com/nicobailon/pi-subagents/releases/tag/v0.37.2)
- [npm metadata](https://registry.npmjs.org/pi-subagents)
- [Aggregate token/cost budget request #693](https://github.com/nicobailon/pi-subagents/issues/693)

## Native Pi alternatives

| Project | Strengths | Fit for this adapter |
|---|---|---|
| [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) | Persistent sessions, parallel/background runs, steering, resume, artifacts, transcripts, widgets, lifecycle events | Closest behavioral peer, but exposes `Agent`/`steer_subagent`, not RPC v1; not drop-in |
| [`@minhduydev/pi-subagents`](https://github.com/MinhDuyDEV/pi-subagents) | Recovery, claims/leases, evidence and review gates, worktrees, artifacts, scheduling, UI/backend fallbacks | Potentially strongest durable feature set; RPC v3 and strict Pi compatibility require migration |
| [`pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows) | Journaled workflows, parallel agents, pause/resume/replay, worktrees, artifacts | Workflow API rather than supervisor RPC; not drop-in |
| [`pi-flow`](https://github.com/kky42/pi-flow) | Persistent session keys, workflow journal/replay, live TUI, multiple backends | No compatible lifecycle/artifact supervisor protocol |
| [`pi-workflow`](https://github.com/AgwaB/pi-workflow) | Durable stage graphs, artifacts, stop/resume state, workflow board | Uses its own subagent layer; not drop-in |

Registry and source references:

- [`@gotgenes/pi-subagents` registry entry](https://pi.dev/packages/@gotgenes/pi-subagents) and [source](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/src/index.ts)
- [`@minhduydev/pi-subagents` registry entry](https://pi.dev/packages/@minhduydev/pi-subagents) and [README](https://github.com/MinhDuyDEV/pi-subagents/blob/main/README.md)
- [`pi-dynamic-workflows` registry entry](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) and [persistence source](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/main/src/run-persistence.ts)
- [`pi-flow` registry entry](https://pi.dev/packages/@kky42/pi-flow), [session keys](https://github.com/kky42/pi-flow/blob/main/src/core/session-key.ts), and [journal](https://github.com/kky42/pi-flow/blob/main/src/workflow/journal.ts)
- [`pi-workflow` registry entry](https://pi.dev/packages/@agwab/pi-workflow) and [store](https://github.com/AgwaB/pi-workflow/blob/main/src/store.ts)

## General orchestration frameworks

LangGraph, AutoGen, CrewAI, and the OpenAI Agents SDK are capable general frameworks, but none is a Pi child-session runtime. Each would require provider/auth bridging, lifecycle and cancellation translation, persistent worker identity, artifact integration, and Pi UI/FleetView support. They are candidates for specialized workflows inside a worker, not replacements for this adapter.

Primary sources:

- [Pi coding agent](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [AutoGen](https://github.com/microsoft/autogen/blob/main/README.md)
- [LangGraph](https://github.com/langchain-ai/langgraph/blob/main/README.md)
- [CrewAI](https://github.com/crewAIInc/crewAI/blob/main/README.md)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-js/blob/main/README.md)

## Recommendation

1. Keep the pinned `nicobailon/pi-subagents` integration for this branch.
2. Validate any move from `0.37.2` to `0.38.x` against RPC capabilities and lifecycle artifacts before updating.
3. Complete authenticated spawn, steering, stop, recovery, and resume gates for both `openai-codex` and `github-copilot`.
4. Reconsider `@minhduydev/pi-subagents` only if its claims/leases, scheduling, or evidence gates justify an intentional adapter rewrite.
