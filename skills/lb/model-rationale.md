# Low-budget model rationale

This profile is inspired by the economical role routing in
`nsEytgXm/subagents_configs`, with provider-specific matrices:

- OpenAI Codex remains Luna-first: Luna high for mechanical work and Luna max for
  exploration, implementation, architecture, and planning;
- GitHub Copilot uses Grok 4.5 high for all ordinary worker roles except review;
- both providers use Sol low for an independent review family;
- GitHub Copilot retains Grok high for `mechanical-judgment` and `escalate-entry`,
  while OpenAI Codex uses Luna max and Luna xhigh respectively.

Artificial Analysis reports Grok 4.5 high at 64.44% on its Coding Agent Index,
48.12% on SWE-Atlas-QnA, and 85.32% on Terminal-Bench v2. The Copilot matrix favors
those broader repository-understanding and terminal-agency results despite Grok's
higher observed cost and latency. Mandatory verification and independent Sol review
remain unchanged.

The frontier remains Sol medium because it owns decomposition and user decisions.
Unlike the source configuration, this profile does not split validation into a
separate agent or make review selective.

