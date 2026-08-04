# Paseo-hosted Pi uses Paseo native child agents

## Status

Accepted for the experimental Paseo integration.

## Context

The Pi adapter normally owns orchestration policy and delegates worker lifecycle to
`pi-subagents` RPC v1. Paseo cannot project those package-owned processes into its
native subagent track. Paseo 0.2.5 already exposes an agent-scoped MCP control plane at
`/mcp/agents`; its `create_agent` operation assigns the caller as parent, provides
finish notifications, and exposes status, activity, usage, cancellation, and follow-up
operations.

Paseo injects that MCP server into a Pi session only when it detects
`pi-mcp-adapter`. It also sets `PASEO_AGENT_ID` and passes a temporary `--mcp-config`
whose `paseo` server URL is scoped to that caller.

## Decision

Keep the public `minions_*` tools and all shared Minions policy behind one runtime
seam with two adapters:

- ordinary Pi uses the existing `pi-subagents` RPC adapter;
- Paseo-hosted Pi, detected from an exact `PASEO_AGENT_ID` plus injected
  `/mcp/agents` config match, uses the Paseo adapter.

The Paseo adapter calls the stateless MCP endpoint directly with its injected
capability headers. It creates native `pi/<provider>/<model>` child agents, maps each
Paseo agent ID to a Minions worker ID, and gives every initial or resumed execution a
separate synthetic run ID. This preserves the existing launch, triage, and usage
accounting semantics even though Paseo reuses one agent for follow-up prompts.

The Paseo platform installer pins `npm:pi-mcp-adapter@2.16.0`; the ordinary Pi
platform continues to pin `npm:pi-subagents@0.37.2`, and `all` installs both. A process carrying `PASEO_AGENT_ID` fails closed when the
matching injected MCP endpoint is absent; it must never fall back to invisible
`pi-subagents` workers. The installer does not modify Paseo's installation or
persisted configuration.

## Consequences

Paseo users see Minions workers in Paseo's native subagent track and receive Paseo
finish notifications. Reloaded Minions sessions retain both board and native-agent
identity. Ordinary Pi behavior remains on `pi-subagents`.

Paseo 0.2.5 does not expose a persistent deadline on `create_agent`; the adapter
therefore never forwards `timeoutSeconds`. Because tool clients can materialize
optional fields despite prompt instructions, an accidental value is retained only as
audit metadata, is reported in the spawn result, and does not shorten the model-aware
`maxDurationSeconds` watchdog. Authenticated release validation must cover child
visibility, status/activity projection, exact-once usage, cancellation, notification,
reload, follow-up, and this deadline normalization.
