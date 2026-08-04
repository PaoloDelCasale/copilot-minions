# Low-budget model rationale

This profile is inspired by the economical role routing in
`nsEytgXm/subagents_configs`. OpenAI Codex keeps Luna low/medium/high according to
role. GitHub Copilot uses its current, much cheaper Luna pricing more aggressively:

- Luna high for bounded mechanical work, avoiding max-effort latency;
- Luna max for exploration, implementation, architecture, and planning;
- Sol low for an independent review family;
- Grok high only as the first evidence-backed escalation after an adverse result.

Artificial Analysis reports Luna max at 58.66% on its Coding Agent Index and 63.42%
on DeepSWE, with about $0.31 observed cost per task, versus Grok high at 64.44%,
59.88% DeepSWE, and about $2.59 per task. Luna therefore fits bounded implementation
particularly well; its weaker repository Q&A is contained by mandatory verification,
independent review, and the evidence-gated Grok escalation.

The frontier remains Sol medium because it owns decomposition and user decisions.
Unlike the source configuration, this profile does not split validation into a
separate agent or make review selective.

