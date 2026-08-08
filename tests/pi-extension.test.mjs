import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { schemas } from "../extensions/pi-minions/index.ts";
import { createPiMinionsExtension } from "../extensions/pi-minions/orchestrator.mjs";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const ASYNC_COMPLETE = "subagent:async-complete";

class FakeEvents {
  constructor() {
    this.handlers = new Map();
    this.emitted = [];
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.emitted.push({ event, payload });
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
}

class FakeSubagentsRuntime {
  constructor(events, options = {}) {
    this.events = events;
    this.options = options;
    this.calls = [];
    this.runs = new Map();
    this.nextRun = 1;
    this.unsubscribe = events.on(RPC_REQUEST, (request) => this.handle(request));
  }

  reply(request, data) {
    this.events.emit(`${RPC_REPLY_PREFIX}${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: true,
      data,
    });
  }

  fail(request, message, code = "execution_failed") {
    this.events.emit(`${RPC_REPLY_PREFIX}${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      method: request.method,
      success: false,
      error: { code, message },
    });
  }

  handle(request) {
    this.calls.push({ method: request.method, params: request.params, request });
    if (request.method === "ping") {
      const info = this.options.ping ?? {
        version: 1,
        methods: ["ping", "status", "spawn", "steer", "interrupt", "stop", "resume"],
        capabilities: {
          asyncSpawn: true,
          steer: true,
          nonRecoveringSteer: true,
          stop: true,
          resume: true,
          processTerminalProof: { version: 1, lifecycleArtifactVersion: 3 },
        },
        events: { asyncComplete: ASYNC_COMPLETE },
      };
      this.reply(request, info);
      return;
    }

    if (request.method === "spawn") {
      const spawnIndex = this.calls.filter((call) => call.method === "spawn").length - 1;
      if (this.options.failSpawnAt === spawnIndex) {
        this.fail(request, `Injected spawn failure ${spawnIndex}`);
        return;
      }
      const id = `sub-run-${this.nextRun++}`;
      this.runs.set(id, { state: "running", params: request.params });
      if (this.options.completeBeforeSpawnReply) {
        this.complete(id, {
          success: true,
          state: "complete",
          summary: "Completed before spawn reply",
        });
      }
      this.reply(request, {
        text: `Async: ${request.params.agent} [${id}]`,
        details: { asyncId: id, asyncDir: `/tmp/pi-subagents/${id}` },
      });
      return;
    }

    if (request.method === "status") {
      const run = this.runs.get(request.params?.id);
      if (!run) {
        this.fail(request, `Run not found: ${request.params?.id}`, "not_found");
        return;
      }
      const summary = run.summary ? `\n\n${run.summary}` : "";
      this.reply(request, {
        text: `Run: ${request.params.id}\nState: ${run.state}${run.error ? `\nError: ${run.error}` : ""}${summary}`,
        details: { mode: "management", results: [] },
        fleet: { version: 1, entries: [], totalActive: run.state === "running" ? 1 : 0, omitted: 0 },
      });
      return;
    }

    if (request.method === "steer") {
      this.reply(request, { text: "Steering delivered.", details: { mode: "management", results: [] } });
      return;
    }

    if (request.method === "stop") {
      const run = this.runs.get(request.params?.id);
      if (!run) {
        this.fail(request, "Run not found", "not_found");
        return;
      }
      run.state = "stopping";
      this.reply(request, { runId: request.params.id, state: "stopping", message: "Stop requested." });
      return;
    }

    if (request.method === "resume") {
      const source = this.runs.get(request.params?.id);
      if (!source || source.state === "stopped") {
        this.fail(request, "Run cannot be resumed", "invalid_state");
        return;
      }
      const id = `sub-run-${this.nextRun++}`;
      this.runs.set(id, { state: "running", params: request.params });
      this.reply(request, {
        text: `Revived async subagent as ${id}.`,
        details: { asyncId: id, asyncDir: `/tmp/pi-subagents/${id}` },
      });
      return;
    }

    this.fail(request, `Unsupported method ${request.method}`, "unsupported_method");
  }

  complete(id, payload = {}) {
    const run = this.runs.get(id);
    if (run) {
      run.state = payload.state ?? (payload.success === false ? "failed" : "complete");
      run.summary = payload.summary;
      run.error = payload.error;
    }
    this.events.emit(ASYNC_COMPLETE, {
      id,
      runId: id,
      timestamp: 5_000,
      agent: run?.params?.agent ?? "pi-minions-worker",
      success: payload.success ?? true,
      state: payload.state ?? (payload.success === false ? "failed" : "complete"),
      summary: payload.summary ?? "Done",
      ...payload,
    });
  }

  byMethod(method) {
    return this.calls.filter((call) => call.method === method);
  }
}

function createHarness({
  provider = "openai-codex",
  modelId = "gpt-5.4",
  missingModels = [],
  modelCatalogs,
  sessionEntries = [],
  setModelResults = [],
  runtimeOptions,
  withRuntime = true,
  dependencies = {},
  loadedDisciplines = [],
} = {}) {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const sentUserMessages = [];
  const sentMessages = [];
  const modelChanges = [];
  const thinkingChanges = [];
  const notifications = [];
  const appendedEntries = [];
  const statuses = [];
  const events = new FakeEvents();
  const runtime = withRuntime ? new FakeSubagentsRuntime(events, runtimeOptions) : undefined;
  const pi = {
    events,
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    sendUserMessage(message) { sentUserMessages.push(message); },
    sendMessage(message, options) { sentMessages.push({ message, options }); },
    on(name, handler) { handlers.set(name, handler); },
    async setModel(model) {
      modelChanges.push(model);
      return setModelResults.length > 0 ? setModelResults.shift() : true;
    },
    setThinkingLevel(level) { thinkingChanges.push(level); },
    getThinkingLevel() { return "high"; },
    appendEntry(customType, data) {
      const entry = { type: "custom", customType, data };
      appendedEntries.push(entry);
      sessionEntries.push(entry);
    },
  };
  const defaultCatalog = provider === "github-copilot"
    ? ["claude-opus-5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "grok-4.5"]
    : provider === "commandcode"
      ? ["gpt-5.6-luna", "deepseek/deepseek-v4-flash", "moonshotai/Kimi-K3", "meta/muse-spark-1.2-contributor", "xai/grok-4.5"]
      : ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
  const catalogs = modelCatalogs ?? { [provider]: defaultCatalog };
  const models = Object.entries(catalogs).flatMap(([catalogProvider, ids]) => ids
    .filter((id) => catalogProvider !== provider || !missingModels.includes(id))
    .map((id) => ({ provider: catalogProvider, id })));
  if (!models.some((model) => model.provider === provider && model.id === modelId)) {
    models.push({ provider, id: modelId });
  }
  const ctx = {
    cwd: "/repo",
    model: { provider, id: modelId },
    modelRegistry: {
      find(candidateProvider, id) {
        return models.find((model) => model.provider === candidateProvider && model.id === id);
      },
    },
    isProjectTrusted() { return true; },
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      setStatus(key, value) { statuses.push({ key, value }); },
    },
    sessionManager: {
      getSessionId() { return "parent-session"; },
      getSessionFile() { return "/sessions/parent.jsonl"; },
      getEntries() { return sessionEntries; },
      getBranch() { return sessionEntries; },
    },
  };
  createPiMinionsExtension(pi, {
    schemas,
    paseoHosted: false,
    orcaHosted: false,
    orcaRuntime: null,
    validateWriterCwd: () => true,
    resolveDiscipline: (name) => loadedDisciplines.includes(name),
    ...dependencies,
  });
  return {
    pi,
    runtime,
    tools,
    commands,
    handlers,
    sentUserMessages,
    sentMessages,
    ctx,
    modelChanges,
    thinkingChanges,
    notifications,
    appendedEntries,
    sessionEntries,
    statuses,
    events,
  };
}

async function execute(tool, params, ctx) {
  return tool.execute("call-1", params, undefined, undefined, ctx);
}

async function start(harness, variant = "standard", activationText) {
  harness.handlers.get("input")({
    source: "interactive",
    text: activationText ?? `/skill:pi-minions${variant === "lb" ? "-lb" : ""}`,
  });
  return execute(harness.tools.get("minions_start"), { variant }, harness.ctx);
}

async function spawn(harness, tasks) {
  return execute(harness.tools.get("minions_spawn"), { tasks }, harness.ctx);
}

test("the extension registers TypeBox schemas for every public Minions tool", () => {
  const harness = createHarness();
  assert.equal(Value.Check(harness.tools.get("minions_start").parameters, {
    variant: "standard",
    maxRunCostUsd: 75,
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "explorer", task: "Inspect", timeoutSeconds: 30 }],
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{
      role: "implementer",
      task: "Retry verified failure",
      routeOverride: "escalate-entry",
      overrideReason: "verification-failure",
      overrideFromWorkerId: "worker-1",
    }],
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "implementer", task: "Invalid evidence", overrideReason: "made-up" }],
  }), false);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{
      role: "reviewer",
      task: "Final review",
      budgetClass: "closure",
      maxCostUsd: 12,
      maxDurationSeconds: 2400,
    }],
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "reviewer", task: "Invalid", budgetClass: "unbounded" }],
  }), false);
  assert.equal(Value.Check(harness.tools.get("minions_resume").parameters, {
    workerId: "worker-1",
    message: "Continue",
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "unknown", task: "Inspect" }],
  }), false);
  assert.equal(Value.Check(harness.tools.get("minions_close").parameters, {
    workerPolicy: "preserve",
    preserveWorkerIds: ["worker-1"],
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_close").parameters, {
    workerPolicy: "delete",
  }), false);
});

test("start verifies pi-subagents RPC v1 before locking the frontier route", async () => {
  const harness = createHarness();
  const result = await start(harness);

  assert.match(result.content[0].text, /pi-subagents RPC v1/);
  assert.equal(harness.runtime.byMethod("ping").length, 1);
  assert.deepEqual(harness.modelChanges, [{ provider: "openai-codex", id: "gpt-5.6-sol" }]);
  assert.deepEqual(harness.thinkingChanges, ["medium"]);
});

test("a Paseo-hosted Pi session fails closed when its MCP bridge was not injected", async () => {
  const harness = createHarness({ dependencies: { paseoHosted: true, paseoRuntime: null } });
  await assert.rejects(start(harness), /agent-scoped MCP runtime is unavailable.*pi-mcp-adapter/i);
  assert.equal(harness.runtime.byMethod("ping").length, 0);
  assert.equal(harness.modelChanges.length, 0);
});

test("an Orca-hosted Pi session fails closed when native CLI identity is unavailable", async () => {
  const harness = createHarness({ dependencies: { orcaHosted: true, orcaRuntime: null } });
  await assert.rejects(start(harness), /runs inside Orca.*native CLI identity.*reopen Pi/i);
  assert.equal(harness.runtime.byMethod("ping").length, 0);
  assert.equal(harness.modelChanges.length, 0);
});

test("start rejects an incompatible pi-subagents runtime without changing model", async () => {
  const harness = createHarness({
    runtimeOptions: {
      ping: {
        version: 1,
        methods: ["ping", "spawn"],
        capabilities: { asyncSpawn: true },
        events: { asyncComplete: ASYNC_COMPLETE },
      },
    },
  });

  await assert.rejects(start(harness), /Incompatible pi-subagents RPC runtime.*status/);
  assert.equal(harness.modelChanges.length, 0);

  const unsafeSteering = createHarness({
    runtimeOptions: {
      ping: {
        version: 1,
        methods: ["ping", "status", "spawn", "steer", "interrupt", "stop", "resume"],
        capabilities: {
          asyncSpawn: true,
          processTerminalProof: { version: 1, lifecycleArtifactVersion: 3 },
        },
        events: { asyncComplete: ASYNC_COMPLETE },
      },
    },
  });
  await assert.rejects(start(unsafeSteering), /requires non-recovering steering/);
  assert.equal(unsafeSteering.modelChanges.length, 0);
});

test("Provider Affinity rejects unsupported providers and missing exact routes", async () => {
  const unsupported = createHarness({ provider: "anthropic" });
  await assert.rejects(start(unsupported), /Unsupported provider: anthropic/);

  const missing = createHarness({ missingModels: ["gpt-5.6-luna"] });
  await assert.rejects(start(missing), /missing required model.*gpt-5\.6-luna/);
  assert.equal(missing.runtime.byMethod("ping").length, 0);

  const copilotLbWithoutLuna = createHarness({
    provider: "github-copilot",
    missingModels: ["gpt-5.6-luna"],
  });
  await start(copilotLbWithoutLuna, "lb");
  assert.equal(copilotLbWithoutLuna.runtime.byMethod("ping").length, 1);

  const missingCopilotLb = createHarness({
    provider: "github-copilot",
    missingModels: ["grok-4.5"],
  });
  await assert.rejects(start(missingCopilotLb, "lb"), /missing required model.*grok-4\.5/);
  assert.equal(missingCopilotLb.runtime.byMethod("ping").length, 0);

  const missingCopilotArchitect = createHarness({
    provider: "github-copilot",
    missingModels: ["claude-opus-5"],
  });
  await assert.rejects(start(missingCopilotArchitect), /missing required model.*claude-opus-5/);
  assert.equal(missingCopilotArchitect.runtime.byMethod("ping").length, 0);
});

test("spawn delegates to the namespaced agent with qualified model, timeout, and explicit discipline", async () => {
  const harness = createHarness({ loadedDisciplines: ["implement"] });
  await start(harness);
  const result = await spawn(harness, [{
    role: "implementer",
    task: "Discipline: load implement if available\nImplement T1",
    cwd: "/repo/.worktrees/t1",
    timeoutSeconds: 90,
  }]);

  const call = harness.runtime.byMethod("spawn")[0];
  assert.deepEqual(call.params, {
    agent: "pi-minions-implementer",
    task: "Discipline: load implement if available\nImplement T1",
    cwd: "/repo/.worktrees/t1",
    context: "fresh",
    model: "openai-codex/gpt-5.6-luna:xhigh",
    async: true,
    clarify: false,
    artifacts: true,
    timeoutMs: 90_000,
    skill: "implement",
    control: {
      enabled: true,
      notifyOn: ["active_long_running", "needs_attention"],
      notifyChannels: ["event"],
    },
  });
  assert.equal(result.details.workers[0].disciplineLoaded, true);
  assert.equal(result.details.workers[0].budgetClass, "normal");
  assert.match(result.content[0].text, /persistent worker/);
});

test("missing optional disciplines use the inline fallback instead of failing launch", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{
    role: "planner",
    task: "Discipline: load to-spec if available\nDraft the PRD",
  }]);

  assert.equal("skill" in harness.runtime.byMethod("spawn")[0].params, false);
  assert.equal(spawned.details.workers[0].disciplineLoaded, false);
  const read = await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.match(read.content[0].text, /discipline to-spec fallback/);
});

test("writer roles require an explicit validated isolated worktree", async () => {
  const missingCwd = createHarness();
  await start(missingCwd);
  await assert.rejects(
    spawn(missingCwd, [{ role: "implementer", task: "Implement" }]),
    /require an explicit isolated worktree cwd/,
  );
  assert.equal(missingCwd.runtime.byMethod("spawn").length, 0);

  const invalid = createHarness({ dependencies: { validateWriterCwd: () => "primary checkout is forbidden" } });
  await start(invalid);
  await assert.rejects(
    spawn(invalid, [{ role: "architect", task: "Implement", cwd: "/repo" }]),
    /primary checkout is forbidden/,
  );
});

test("writer worktrees remain exclusively leased until their worker is terminal", async () => {
  const harness = createHarness();
  await start(harness);
  const first = await spawn(harness, [{
    role: "implementer",
    task: "Implement A",
    cwd: "/repo/.worktrees/shared",
  }]);

  await assert.rejects(spawn(harness, [{
    role: "architect",
    task: "Implement B",
    cwd: "/repo/.worktrees/shared",
  }]), /worktree is leased.*implementer/i);
  assert.equal(harness.runtime.byMethod("spawn").length, 1);

  harness.runtime.complete(first.details.workers[0].subagentRunId, { summary: "Committed A" });
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  const second = await spawn(harness, [{
    role: "architect",
    task: "Implement B",
    cwd: "/repo/.worktrees/shared",
  }]);
  assert.equal(second.details.workers[0].maxCostUsd, 60);
  assert.equal(second.details.workers[0].maxDurationSeconds, 150 * 60);
});

test("spawn preflights the entire batch before starting any child", async () => {
  const harness = createHarness();
  await start(harness, "standard", "/skill:pi-minions use gpt-missing for the next batch");
  await assert.rejects(spawn(harness, [
    { role: "explorer", task: "Explore" },
    { role: "implementer", task: "Implement", cwd: "/repo/.worktrees/t1", modelOverride: "gpt-missing" },
  ]), /does not offer requested model gpt-missing/);
  assert.equal(harness.runtime.byMethod("spawn").length, 0);
});

test("model overrides without an explicit user request are audited and downgraded", async () => {
  const harness = createHarness({
    provider: "github-copilot",
    modelCatalogs: {
      "github-copilot": [
        "claude-opus-5",
        "gpt-5.3-codex",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "grok-4.5",
      ],
    },
  });
  await start(harness);
  const result = await spawn(harness, [{
    role: "planner",
    task: "Plan the work",
    modelOverride: "gpt-5.3-codex",
  }]);

  assert.equal(
    harness.runtime.byMethod("spawn")[0].params.model,
    "github-copilot/gpt-5.6-terra:max",
  );
  assert.equal(result.details.workers[0].requestedModelOverride, "gpt-5.3-codex");
  assert.equal(result.details.workers[0].modelOverride, undefined);
  assert.match(result.details.workers[0].modelOverrideRejection, /not explicitly requested by the user/i);
  assert.match(result.content[0].text, /ignored 1 invalid model override/i);
});

test("an explicitly user-requested model override is limited to the next batch", async () => {
  const harness = createHarness({
    provider: "github-copilot",
    modelCatalogs: {
      "github-copilot": [
        "claude-opus-5",
        "gpt-5.3-codex",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "grok-4.5",
      ],
    },
  });
  await start(
    harness,
    "standard",
    "/skill:pi-minions usa gpt-5.3-codex per il prossimo batch",
  );
  const authorized = await spawn(harness, [{
    role: "planner",
    task: "Plan the work",
    modelOverride: "gpt-5.3-codex",
  }]);
  const repeated = await spawn(harness, [{
    role: "planner",
    task: "Plan another batch",
    modelOverride: "gpt-5.3-codex",
  }]);

  assert.deepEqual(
    harness.runtime.byMethod("spawn").map((call) => call.params.model),
    ["github-copilot/gpt-5.3-codex:max", "github-copilot/gpt-5.6-terra:max"],
  );
  assert.equal(authorized.details.workers[0].modelOverride, "gpt-5.3-codex");
  assert.equal(authorized.details.workers[0].modelOverrideRejection, undefined);
  assert.match(repeated.details.workers[0].modelOverrideRejection, /not explicitly requested by the user/i);
});

test("the direct /minions command preserves an explicit model request", async () => {
  const harness = createHarness({
    provider: "github-copilot",
    modelCatalogs: {
      "github-copilot": [
        "claude-opus-5",
        "gpt-5.3-codex",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "grok-4.5",
      ],
    },
  });
  await harness.commands.get("minions").handler("usa gpt-5.3-codex per il prossimo batch");
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const result = await spawn(harness, [{
    role: "planner",
    task: "Plan the work",
    modelOverride: "gpt-5.3-codex",
  }]);

  assert.equal(
    harness.runtime.byMethod("spawn")[0].params.model,
    "github-copilot/gpt-5.3-codex:max",
  );
  assert.equal(result.details.workers[0].modelOverrideRejection, undefined);
});

test("a partially failed RPC batch retains every launched child through terminal usage", async () => {
  const harness = createHarness({ runtimeOptions: { failSpawnAt: 2 } });
  await start(harness);
  await assert.rejects(spawn(harness, [
    { role: "explorer", task: "Explore A" },
    { role: "reviewer", task: "Review B" },
    { role: "planner", task: "Plan C" },
  ]), /Injected spawn failure/);

  assert.equal(harness.runtime.byMethod("spawn").length, 3);
  assert.deepEqual(harness.runtime.byMethod("stop").map((call) => call.params.id), ["sub-run-1", "sub-run-2"]);
  const stopping = await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.deepEqual(stopping.details.workers.map((worker) => worker.status), ["stopping", "stopping"]);
  await assert.rejects(execute(harness.tools.get("minions_close"), {}, harness.ctx), /2 live worker/);

  const usage = {
    totalTokens: { input: 10, output: 2, total: 12 },
    totalCost: { inputTokens: 10, outputTokens: 2, costUsd: 0.03 },
  };
  harness.runtime.complete("sub-run-1", { state: "stopped", success: false, summary: "Stopped A", ...usage });
  harness.runtime.complete("sub-run-2", { state: "stopped", success: false, summary: "Stopped B", ...usage });
  const terminal = await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.deepEqual(terminal.details.workers.map((worker) => worker.status), ["stopped", "stopped"]);
  assert.equal(terminal.usage.totalTokens, 24);
  assert.equal(terminal.usage.cost.total, 0.06);
  const repeated = await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.equal(repeated.usage, undefined);
  await execute(harness.tools.get("minions_close"), {}, harness.ctx);
});

test("provider and low-budget matrices are preserved through per-run model overrides", async () => {
  const cases = [
    { provider: "openai-codex", variant: "lb", role: "mechanical", expected: "openai-codex/gpt-5.6-luna:high" },
    { provider: "openai-codex", variant: "lb", role: "explorer", expected: "openai-codex/gpt-5.6-luna:max" },
    { provider: "openai-codex", variant: "lb", role: "implementer", expected: "openai-codex/gpt-5.6-luna:max" },
    { provider: "openai-codex", variant: "lb", role: "architect", expected: "openai-codex/gpt-5.6-luna:max" },
    { provider: "openai-codex", variant: "lb", role: "reviewer", expected: "openai-codex/gpt-5.6-sol:low" },
    { provider: "openai-codex", variant: "lb", role: "planner", expected: "openai-codex/gpt-5.6-luna:max" },
    { provider: "github-copilot", variant: "standard", role: "mechanical", expected: "github-copilot/gpt-5.6-luna:high" },
    { provider: "github-copilot", variant: "standard", role: "explorer", expected: "github-copilot/claude-opus-5:high" },
    { provider: "github-copilot", variant: "standard", role: "implementer", expected: "github-copilot/gpt-5.6-terra:max" },
    { provider: "github-copilot", variant: "standard", role: "architect", expected: "github-copilot/claude-opus-5:xhigh" },
    { provider: "github-copilot", variant: "standard", role: "reviewer", expected: "github-copilot/gpt-5.6-sol:high" },
    { provider: "github-copilot", variant: "standard", role: "planner", expected: "github-copilot/gpt-5.6-terra:max" },
    { provider: "github-copilot", variant: "lb", role: "mechanical", expected: "github-copilot/grok-4.5:high" },
    { provider: "github-copilot", variant: "lb", role: "explorer", expected: "github-copilot/grok-4.5:high" },
    { provider: "github-copilot", variant: "lb", role: "implementer", expected: "github-copilot/grok-4.5:high" },
    { provider: "github-copilot", variant: "lb", role: "architect", expected: "github-copilot/grok-4.5:high" },
    { provider: "github-copilot", variant: "lb", role: "reviewer", expected: "github-copilot/gpt-5.6-sol:low" },
    { provider: "github-copilot", variant: "lb", role: "planner", expected: "github-copilot/grok-4.5:high" },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: entry.provider });
    await start(harness, entry.variant);
    await spawn(harness, [{
      role: entry.role,
      task: entry.role,
      ...(["implementer", "architect"].includes(entry.role) ? { cwd: `/repo/.worktrees/${entry.role}` } : {}),
    }]);
    assert.equal(harness.runtime.byMethod("spawn")[0].params.model, entry.expected);
  }
});

test("model-aware worker and run cost ceilings use the expanded shared budget profile", async () => {
  const cases = [
    { provider: "openai-codex", role: "mechanical", model: "gpt-5.6-luna", max: 24, warning: 16, duration: 180 * 60 },
    { provider: "openai-codex", role: "planner", model: "gpt-5.6-terra", max: 40, warning: 24, duration: 180 * 60 },
    { provider: "openai-codex", role: "reviewer", model: "gpt-5.6-sol", max: 60, warning: 40, duration: 150 * 60 },
    { provider: "github-copilot", role: "explorer", model: "claude-opus-5", max: 60, warning: 40, duration: 240 * 60 },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: entry.provider });
    await start(harness);
    const spawned = await spawn(harness, [{ role: entry.role, task: entry.role }]);
    assert.equal(spawned.details.workers[0].model, entry.model);
    assert.equal(spawned.details.workers[0].maxCostUsd, entry.max);
    assert.equal(spawned.details.workers[0].warningCostUsd, entry.warning);
    assert.equal(spawned.details.workers[0].maxDurationSeconds, entry.duration);
    assert.equal(harness.appendedEntries.at(-1).data.runCostCeilingUsd, 160);
  }

  const grok = createHarness({ provider: "github-copilot" });
  await start(grok, "lb", "/skill:pi-minions-lb use grok-4.5 for the next batch");
  const grokWorker = await spawn(grok, [{
    role: "explorer",
    task: "Bounded Grok check",
    modelOverride: "grok-4.5",
  }]);
  assert.equal(grokWorker.details.workers[0].maxCostUsd, 40);
  assert.equal(grokWorker.details.workers[0].warningCostUsd, 24);
  assert.equal(grokWorker.details.workers[0].maxDurationSeconds, 180 * 60);
});

test("frontier payloads cannot shrink the shared cost or duration safety floors", async () => {
  const harness = createHarness({ provider: "github-copilot" });
  harness.handlers.get("input")({ source: "interactive", text: "/skill:pi-minions" });
  await execute(harness.tools.get("minions_start"), {
    variant: "standard",
    maxRunCostUsd: 10,
  }, harness.ctx);
  const result = await spawn(harness, [{
    role: "mechanical",
    task: "Read-only smoke test",
    maxCostUsd: 1,
    maxDurationSeconds: 600,
  }]);
  assert.equal(result.details.workers[0].maxCostUsd, 24);
  assert.equal(result.details.workers[0].warningCostUsd, 16);
  assert.equal(result.details.workers[0].maxDurationSeconds, 180 * 60);
  assert.equal(harness.appendedEntries.at(-1).data.runCostCeilingUsd, 160);
});

test("Copilot Opus architects receive the explicit quality-route watchdog budget", async () => {
  const harness = createHarness({ provider: "github-copilot" });
  await start(harness);
  const result = await spawn(harness, [{
    role: "architect",
    task: "Design and implement",
    cwd: "/repo/.worktrees/opus-architect",
  }]);
  assert.equal(result.details.workers[0].maxCostUsd, 60);
  assert.equal(result.details.workers[0].warningCostUsd, 40);
  assert.equal(result.details.workers[0].maxDurationSeconds, 240 * 60);
});

test("named escalation routes retain their provider-specific model and effort", async () => {
  const codex = createHarness();
  await start(codex);
  const codexPrior = await spawn(codex, [{ role: "reviewer", task: "Initial review" }]);
  codex.runtime.complete(codexPrior.details.workers[0].subagentRunId, {
    summary: "STATUS: DONE_WITH_CONCERNS\nVerification was incomplete.",
  });
  await execute(codex.tools.get("minions_read"), {}, codex.ctx);
  await spawn(codex, [{
    role: "implementer",
    task: "Retry",
    cwd: "/repo/.worktrees/retry-codex",
    routeOverride: "escalate-sol-max",
    overrideReason: "mediocre-result",
    overrideFromWorkerId: codexPrior.details.workers[0].id,
  }]);
  assert.equal(codex.runtime.byMethod("spawn").at(-1).params.model, "openai-codex/gpt-5.6-sol:max");

  const copilot = createHarness({ provider: "github-copilot" });
  await start(copilot);
  const copilotPrior = await spawn(copilot, [{ role: "explorer", task: "Initial discovery" }]);
  copilot.runtime.complete(copilotPrior.details.workers[0].subagentRunId, {
    success: false,
    state: "failed",
    summary: "STATUS: BLOCKED\nRepository discovery failed.",
  });
  await execute(copilot.tools.get("minions_read"), {}, copilot.ctx);
  await spawn(copilot, [{
    role: "mechanical",
    task: "Resolve merge conflict",
    routeOverride: "mechanical-judgment",
    overrideReason: "merge-conflict",
  }, {
    role: "implementer",
    task: "Escalated retry",
    cwd: "/repo/.worktrees/retry-copilot",
    routeOverride: "escalate-entry",
    overrideReason: "blocked",
    overrideFromWorkerId: copilotPrior.details.workers[0].id,
  }]);
  assert.deepEqual(
    copilot.runtime.byMethod("spawn").slice(-2).map((call) => call.params.model),
    ["github-copilot/gpt-5.6-terra:max", "github-copilot/gpt-5.6-sol:high"],
  );
});

test("Codex low-budget keeps its Luna routes and escalation", async () => {
  const harness = createHarness({ provider: "openai-codex" });
  await start(harness, "lb");
  const prior = await spawn(harness, [{ role: "explorer", task: "Initial Luna discovery" }]);
  harness.runtime.complete(prior.details.workers[0].subagentRunId, {
    success: false,
    state: "failed",
    summary: "STATUS: BLOCKED\nLuna could not resolve repository context.",
  });
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  await spawn(harness, [{
    role: "mechanical",
    task: "Resolve merge conflict",
    routeOverride: "mechanical-judgment",
    overrideReason: "merge-conflict",
  }, {
    role: "explorer",
    task: "Escalate repository discovery",
    routeOverride: "escalate-entry",
    overrideReason: "blocked",
    overrideFromWorkerId: prior.details.workers[0].id,
  }]);
  assert.deepEqual(
    harness.runtime.byMethod("spawn").slice(-2).map((call) => call.params.model),
    ["openai-codex/gpt-5.6-luna:max", "openai-codex/gpt-5.6-luna:xhigh"],
  );
});

test("Copilot low-budget judgment and first escalation use Grok high", async () => {
  const harness = createHarness({ provider: "github-copilot" });
  await start(harness, "lb");
  const prior = await spawn(harness, [{ role: "explorer", task: "Initial Grok discovery" }]);
  harness.runtime.complete(prior.details.workers[0].subagentRunId, {
    success: false,
    state: "failed",
    summary: "STATUS: BLOCKED\nGrok could not resolve repository context.",
  });
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  await spawn(harness, [{
    role: "mechanical",
    task: "Resolve merge conflict",
    routeOverride: "mechanical-judgment",
    overrideReason: "merge-conflict",
  }, {
    role: "explorer",
    task: "Escalate repository discovery",
    routeOverride: "escalate-entry",
    overrideReason: "blocked",
    overrideFromWorkerId: prior.details.workers[0].id,
  }]);
  assert.deepEqual(
    harness.runtime.byMethod("spawn").slice(-2).map((call) => call.params.model),
    ["github-copilot/grok-4.5:high", "github-copilot/grok-4.5:high"],
  );
});

test("invalid named route overrides are audited and downgraded to role routes", async () => {
  const harness = createHarness({ provider: "github-copilot" });
  await start(harness);
  const explorer = await spawn(harness, [{
    role: "explorer",
    task: "Initial discovery must use the role route",
    routeOverride: "escalate-entry",
  }]);
  const mechanical = await spawn(harness, [{
    role: "mechanical",
    task: "Create a worktree",
    routeOverride: "mechanical-judgment",
  }]);

  assert.deepEqual(
    harness.runtime.byMethod("spawn").map((call) => call.params.model),
    ["github-copilot/claude-opus-5:high", "github-copilot/gpt-5.6-luna:high"],
  );
  assert.match(explorer.content[0].text, /Ignored 1 invalid route override/);
  assert.equal(explorer.details.workers[0].requestedRouteOverride, "escalate-entry");
  assert.equal(explorer.details.workers[0].routeOverride, undefined);
  assert.match(explorer.details.workers[0].routeOverrideRejection, /failure-class overrideReason/);
  assert.equal(mechanical.details.workers[0].requestedRouteOverride, "mechanical-judgment");
  assert.equal(mechanical.details.workers[0].routeOverride, undefined);
  assert.match(mechanical.details.workers[0].routeOverrideRejection, /requires overrideReason/);
});

test("Copilot LB preserves roles when a frontier repeats invalid judgment fields", async () => {
  const harness = createHarness({ provider: "github-copilot" });
  await start(harness, "lb");
  const result = await spawn(harness, [{
    role: "explorer",
    task: "Map repository seams",
    routeOverride: "mechanical-judgment",
    overrideReason: "github-judgment",
    overrideFromWorkerId: "",
    modelOverride: "",
    timeoutSeconds: 3600,
    maxDurationSeconds: 1800,
  }, {
    role: "implementer",
    task: "Implement the bounded slice",
    cwd: "/repo/.worktrees/lb-implementer",
    routeOverride: "mechanical-judgment",
    overrideReason: "github-judgment",
    overrideFromWorkerId: "",
    modelOverride: "",
    timeoutSeconds: 3600,
    maxDurationSeconds: 3600,
  }, {
    role: "reviewer",
    task: "Review the fixed-point diff",
    routeOverride: "mechanical-judgment",
    overrideReason: "github-judgment",
    overrideFromWorkerId: "",
    modelOverride: "",
    timeoutSeconds: 3600,
    maxDurationSeconds: 2400,
  }]);

  assert.deepEqual(
    harness.runtime.byMethod("spawn").map((call) => call.params.model),
    [
      "github-copilot/grok-4.5:high",
      "github-copilot/grok-4.5:high",
      "github-copilot/gpt-5.6-sol:low",
    ],
  );
  assert.deepEqual(result.details.workers.map((worker) => worker.role), ["explorer", "implementer", "reviewer"]);
  assert.equal(result.details.workers.every((worker) => worker.routeOverride === undefined), true);
  assert.equal(result.details.workers.every((worker) => /mechanical role/.test(worker.routeOverrideRejection)), true);
  assert.match(result.content[0].text, /Ignored 3 invalid route override/);
  assert.match(result.content[0].text, /explorer .*mechanical-judgment is valid only for the mechanical role/);
});

test("the wrapper enforces six concurrent workers", async () => {
  const harness = createHarness();
  await start(harness);
  const paused = await spawn(harness, [{ role: "reviewer", task: "Pause me", budgetClass: "closure" }]);
  const pausedWorker = paused.details.workers[0];
  harness.runtime.complete(pausedWorker.subagentRunId, { success: false, state: "paused", summary: "Need another pass" });
  const live = await spawn(harness, Array.from({ length: 6 }, (_, index) => ({ role: "explorer", task: `Explore ${index}` })));
  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: pausedWorker.id,
    message: "Resume despite full live capacity",
  }, harness.ctx), /at most 6 in-flight/);
  assert.equal(harness.runtime.byMethod("resume").length, 0);
  for (const worker of live.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
});

test("the soft triage handoff permits only closure work until the hard limit", async () => {
  const harness = createHarness();
  await start(harness);
  await assert.rejects(spawn(harness, [{ role: "explorer", task: "Misclassified", budgetClass: "closure" }]), /closure budget class.*role/i);

  const closurePaused = await spawn(harness, [{ role: "reviewer", task: "Final review", budgetClass: "closure" }]);
  const normalPaused = await spawn(harness, [{ role: "reviewer", task: "Ordinary review" }]);
  for (const worker of [closurePaused.details.workers[0], normalPaused.details.workers[0]]) {
    harness.runtime.complete(worker.subagentRunId, { success: false, state: "paused", summary: "Need another pass" });
  }
  for (const [batch, size] of [6, 6, 6, 6, 6, 6, 2].entries()) {
    const discovery = await spawn(harness, Array.from({ length: size }, (_, index) => ({
      role: "explorer",
      task: `Explore ${batch}-${index}`,
    })));
    for (const worker of discovery.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
  }
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);

  const spawnCallsAtSoftLimit = harness.runtime.byMethod("spawn").length;
  await assert.rejects(spawn(harness, [{ role: "planner", task: "New scope" }]), /soft 40-result triage limit.*closure/i);
  assert.equal(harness.runtime.byMethod("spawn").length, spawnCallsAtSoftLimit);
  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: normalPaused.details.workers[0].id,
    message: "Continue ordinary work",
  }, harness.ctx), /soft 40-result triage limit.*closure/i);

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: closurePaused.details.workers[0].id,
    message: "Finish the closure review",
  }, harness.ctx);
  assert.equal(resumed.details.worker.budgetClass, "closure");
  harness.runtime.complete(resumed.details.worker.subagentRunId, { summary: "approved" });
  await execute(harness.tools.get("minions_read"), { workerIds: [resumed.details.worker.id] }, harness.ctx);

  for (const [batch, size] of [6, 3].entries()) {
    const final = await spawn(harness, Array.from({ length: size }, (_, index) => ({
      role: "mechanical",
      task: `Landing ${batch}-${index}`,
      budgetClass: "closure",
    })));
    for (const worker of final.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "landed" });
    await execute(harness.tools.get("minions_read"), { workerIds: final.details.workers.map((worker) => worker.id) }, harness.ctx);
  }

  const callsAtHardLimit = harness.runtime.byMethod("spawn").length;
  await assert.rejects(spawn(harness, [{ role: "mechanical", task: "Too late", budgetClass: "closure" }]), /hard 50-result triage limit/i);
  assert.equal(harness.runtime.byMethod("spawn").length, callsAtHardLimit);
  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: normalPaused.details.workers[0].id,
    message: "Too late",
  }, harness.ctx), /hard 50-result triage limit/i);
});

test("the wrapper enforces the fifty-launch worker budget even when results are unread", async () => {
  const harness = createHarness();
  await start(harness);
  for (const [batch, size] of [6, 6, 6, 6, 6, 6, 6, 6, 2].entries()) {
    const result = await spawn(harness, Array.from({ length: size }, (_, index) => ({
      role: "explorer",
      task: `Batch ${batch} task ${index}`,
    })));
    for (const worker of result.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
  }
  await assert.rejects(spawn(harness, [{ role: "planner", task: "Fifty-first" }]), /at most 50 worker launches/);
});

test("partial successes consume their launch budget before the stop lifecycle completes", async () => {
  const harness = createHarness({ runtimeOptions: { failSpawnAt: 49 } });
  await start(harness);
  for (const size of [6, 6, 6, 6, 6, 6, 6, 6]) {
    const batch = await spawn(harness, Array.from({ length: size }, (_, index) => ({
      role: "explorer",
      task: `Completed task ${size}-${index}`,
    })));
    for (const worker of batch.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
  }

  await assert.rejects(spawn(harness, [
    { role: "explorer", task: "Partial A" },
    { role: "reviewer", task: "Partial B" },
  ]), /Injected spawn failure/);
  await assert.rejects(spawn(harness, [
    { role: "planner", task: "Would exceed A" },
    { role: "planner", task: "Would exceed B" },
  ]), /at most 50 worker launches/);
  assert.equal(harness.runtime.byMethod("spawn").length, 50);
});

test("completion output, tokens, and cost are credited exactly once", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  const worker = spawned.details.workers[0];
  const completion = {
    summary: "Found the answer",
    totalTokens: { input: 100, output: 20, total: 120 },
    totalCost: { inputTokens: 100, outputTokens: 20, costUsd: 0.25 },
  };
  harness.runtime.complete(worker.subagentRunId, completion);

  const first = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  const second = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  harness.runtime.complete(worker.subagentRunId, completion);
  const duplicate = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);

  assert.match(first.content[0].text, /Found the answer/);
  assert.deepEqual(first.usage, {
    input: 100,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 120,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
  });
  assert.equal(second.usage, undefined);
  assert.equal(duplicate.usage, undefined);
});

test("an early completion emitted before the spawn reply is retained", async () => {
  const harness = createHarness({ runtimeOptions: { completeBeforeSpawnReply: true } });
  await start(harness);
  const result = await spawn(harness, [{ role: "explorer", task: "Fast task" }]);
  const read = await execute(harness.tools.get("minions_read"), {
    workerIds: [result.details.workers[0].id],
  }, harness.ctx);
  assert.equal(read.details.workers[0].status, "done");
  assert.match(read.content[0].text, /Completed before spawn reply/);
});

test("read reconciles persisted status even when a completion event was missed", async () => {
  const harness = createHarness({
    dependencies: {
      readLifecycle: (worker) => ({
        runId: worker.subagentRunId,
        state: "complete",
        endedAt: 4_900,
        summary: "Recovered from lifecycle artifact",
        totalTokens: { input: 80, output: 20, total: 100 },
        totalCost: { inputTokens: 80, outputTokens: 20, costUsd: 0.15 },
      }),
    },
  });
  await start(harness);
  const result = await spawn(harness, [{ role: "explorer", task: "Inspect" }]);
  const worker = result.details.workers[0];
  Object.assign(harness.runtime.runs.get(worker.subagentRunId), {
    state: "complete",
  });
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "done");
  assert.equal(read.details.workers[0].completedAt, 4_900);
  assert.match(read.content[0].text, /Recovered from lifecycle artifact/);
  assert.equal(read.usage.totalTokens, 100);
  assert.equal(read.usage.cost.total, 0.15);
});

test("steering uses the exact package-owned async run id", async () => {
  const harness = createHarness();
  await start(harness);
  const result = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  const worker = result.details.workers[0];
  const steered = await execute(harness.tools.get("minions_steer"), {
    workerId: worker.id,
    message: "Focus on auth",
  }, harness.ctx);
  assert.match(steered.content[0].text, /delivered/i);
  assert.deepEqual(harness.runtime.byMethod("steer")[0].params, {
    id: worker.subagentRunId,
    message: "Focus on auth",
  });
});

test("stop waits for the package completion lifecycle before close", async () => {
  const harness = createHarness();
  await start(harness);
  const result = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  const worker = result.details.workers[0];
  await execute(harness.tools.get("minions_stop"), { workerIds: [worker.id] }, harness.ctx);

  await assert.rejects(execute(harness.tools.get("minions_close"), {}, harness.ctx), /one live worker|1 live worker/);
  harness.runtime.complete(worker.subagentRunId, { state: "stopped", success: false, summary: "Stopped" });
  await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.match(closed.content[0].text, /Closed orchestration/);
  assert.deepEqual(closed.details.disposedWorkerIds, [worker.id]);
});

test("a failed or paused worker can be resumed without losing its Minions identity", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{ role: "reviewer", task: "Review" }]);
  const original = spawned.details.workers[0];
  harness.runtime.complete(original.subagentRunId, {
    success: false,
    state: "paused",
    summary: "Need another pass",
  });

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: original.id,
    message: "Continue with the supplied context",
  }, harness.ctx);
  assert.equal(resumed.details.worker.id, original.id);
  assert.notEqual(resumed.details.worker.subagentRunId, original.subagentRunId);
  assert.equal(resumed.details.worker.status, "in-flight");
  assert.deepEqual(harness.runtime.byMethod("resume")[0].params, {
    id: original.subagentRunId,
    message: "Continue with the supplied context",
  });
});

test("a worker rotates to fresh context after one continuation", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{ role: "explorer", task: "Inspect the slice" }]);
  const worker = spawned.details.workers[0];
  harness.runtime.complete(worker.subagentRunId, { summary: "Initial inspection complete" });
  await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: worker.id,
    message: "Check the bounded follow-up",
  }, harness.ctx);
  harness.runtime.complete(resumed.details.worker.subagentRunId, { summary: "Follow-up complete" });
  await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);

  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: worker.id,
    message: "Continue growing the retained context",
  }, harness.ctx), /context rotation.*fresh worker/i);
  assert.equal(harness.runtime.byMethod("resume").length, 1);
});

test("a completed architect can resume as the same routed architecture owner", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{
    role: "architect",
    task: "Implement the cross-cutting slice",
    cwd: "/repo/.worktrees/architecture-owner",
  }]);
  const original = spawned.details.workers[0];
  harness.runtime.complete(original.subagentRunId, {
    summary: "Initial architecture implementation complete",
  });
  await execute(harness.tools.get("minions_read"), {
    workerIds: [original.id],
  }, harness.ctx);

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: original.id,
    message: "Continue the same slice with the new reviewer findings",
  }, harness.ctx);
  assert.equal(resumed.details.worker.id, original.id);
  assert.notEqual(resumed.details.worker.subagentRunId, original.subagentRunId);
  assert.equal(resumed.details.worker.role, "architect");
  assert.equal(resumed.details.worker.model, "gpt-5.6-sol");
  assert.equal(resumed.details.worker.thinking, "medium");
  assert.equal(resumed.details.worker.cwd, "/repo/.worktrees/architecture-owner");
  assert.equal(resumed.details.worker.status, "in-flight");
  assert.deepEqual(harness.runtime.byMethod("resume")[0].params, {
    id: original.subagentRunId,
    message: "Continue the same slice with the new reviewer findings",
  });
});

test("close requires durable triage, restores the original model, and disposes ordinary Pi workers", async () => {
  const harness = createHarness({ provider: "github-copilot", modelId: "gpt-4.1" });
  await start(harness);
  const spawned = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  const worker = spawned.details.workers[0];
  harness.runtime.complete(worker.subagentRunId, {
    totalTokens: { input: 10, output: 2, total: 12 },
    totalCost: { inputTokens: 10, outputTokens: 2, costUsd: 0.03 },
  });

  await assert.rejects(execute(harness.tools.get("minions_close"), {}, harness.ctx), /read and triaged/);
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.usage.totalTokens, 12);
  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.deepEqual(harness.modelChanges.at(-1), { provider: "github-copilot", id: "gpt-4.1" });
  assert.equal(harness.thinkingChanges.at(-1), "high");
  assert.equal(closed.usage, undefined);
  assert.deepEqual(closed.details.disposedWorkerIds, [worker.id]);
  assert.deepEqual(closed.details.disposalFailures, []);
  assert.match(closed.content[0].text, /Workers disposed: 1.*Workers preserved: 0.*Disposal failures: 0/);
  const repeated = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.match(repeated.content[0].text, /Workers disposed: 0/);
});

test("a failed model restore leaves the orchestration active", async () => {
  const harness = createHarness({ setModelResults: [true, false] });
  await start(harness);
  await assert.rejects(execute(harness.tools.get("minions_close"), {}, harness.ctx), /Unable to restore/);
  const read = await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.deepEqual(read.details.workers, []);
  assert.equal(harness.appendedEntries.at(-1).data.lifecycle, "active");
});

test("reload preserves active package-owned runs instead of aborting them", async () => {
  const first = createHarness();
  await start(first);
  const spawned = await spawn(first, [{ role: "reviewer", task: "Long final review", budgetClass: "closure" }]);
  first.handlers.get("session_shutdown")({ reason: "reload" }, first.ctx);
  const saved = [...first.sessionEntries];
  assert.equal(first.events.handlers.get(ASYNC_COMPLETE)?.size ?? 0, 0);

  const second = createHarness({ sessionEntries: saved });
  second.handlers.get("session_start")({ reason: "reload" }, second.ctx);
  const startAgain = await start(second);

  assert.match(startAgain.content[0].text, /already active/);
  const savedWorker = saved.filter((entry) => entry.customType === "pi-minions-state").at(-1).data.workers[0];
  assert.equal(savedWorker.subagentRunId, spawned.details.workers[0].subagentRunId);
  assert.equal(savedWorker.budgetClass, "closure");
  assert.equal(first.runtime.byMethod("stop").length, 0);
});

test("session changes remain blocked until the orchestration is explicitly closed", async () => {
  const harness = createHarness();
  await start(harness);
  const spawned = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  harness.runtime.complete(spawned.details.workers[0].subagentRunId);
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  assert.deepEqual(await harness.handlers.get("session_before_switch")({}, harness.ctx), { cancel: true });
  assert.deepEqual(await harness.handlers.get("session_before_fork")({}, harness.ctx), { cancel: true });
  await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.equal(await harness.handlers.get("session_before_switch")({}, harness.ctx), undefined);
});

test("frontier model and thinking remain locked during an active run", async () => {
  const harness = createHarness();
  await start(harness);
  await harness.handlers.get("model_select")({ model: { provider: "openai-codex", id: "gpt-5.6-luna" } }, harness.ctx);
  harness.handlers.get("thinking_level_select")({ level: "high" }, harness.ctx);
  assert.deepEqual(harness.modelChanges.at(-1), { provider: "openai-codex", id: "gpt-5.6-sol" });
  assert.equal(harness.thinkingChanges.at(-1), "medium");
});

test("Pi Minions is authorized only by slash commands", async () => {
  const harness = createHarness();
  const naturalItalian = harness.handlers.get("input")({
    source: "rpc",
    text: "Lavora alla issue con Minions e verifica i test",
  });
  const naturalEnglish = harness.handlers.get("input")({
    source: "rpc",
    text: "Using minions, implement this in low-budget mode",
  });
  const allowedWorkspaceBeforeSlash = harness.handlers.get("tool_call")({
    toolName: "mcp",
    input: { tool: "paseo_create_workspace", args: {} },
  });
  await assert.rejects(
    execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx),
    /slash-command-only.*explicitly invoke \/minions/i,
  );

  const transformed = harness.handlers.get("input")({
    source: "interactive",
    text: "/skill:codex-minions build this",
  });
  const blockedWorkspace = harness.handlers.get("tool_call")({
    toolName: "mcp",
    input: { tool: "paseo_create_workspace", args: {} },
  });
  const paseoAlias = harness.handlers.get("input")({
    source: "interactive",
    text: "/skill:paseo-minions-lb build this cheaply",
  });
  const allowedMcp = harness.handlers.get("tool_call")({
    toolName: "mcp",
    input: { tool: "paseo_get_agent_activity", args: {} },
  });
  const optedOut = harness.handlers.get("input")({
    source: "rpc",
    text: "Lavora senza minions su questa issue",
  });
  const allowedAfterOptOut = harness.handlers.get("tool_call")({
    toolName: "mcp",
    input: { tool: "paseo_create_workspace", args: {} },
  });
  const prompt = harness.handlers.get("before_agent_start")({ systemPrompt: "base" }, harness.ctx);

  assert.deepEqual(naturalItalian, { action: "continue" });
  assert.deepEqual(naturalEnglish, { action: "continue" });
  assert.equal(allowedWorkspaceBeforeSlash, undefined);
  assert.equal(transformed.text, "/skill:pi-minions build this");
  assert.equal(blockedWorkspace.block, true);
  assert.match(blockedWorkspace.reason, /current Paseo Workspace/);
  assert.equal(paseoAlias.text, "/skill:pi-minions-lb build this cheaply");
  assert.equal(allowedMcp, undefined);
  assert.deepEqual(optedOut, { action: "continue" });
  assert.equal(allowedAfterOptOut, undefined);
  assert.match(prompt.systemPrompt, /strictly slash-command-only/i);
  assert.match(prompt.systemPrompt, /never infer, select, or start Minions/i);
  assert.match(prompt.systemPrompt, /never call MCP create_workspace/i);
  assert.match(prompt.systemPrompt, /existing Paseo workspace/i);
  assert.match(prompt.systemPrompt, /linked Git worktree/i);
  assert.match(prompt.systemPrompt, /minions_start only initializes.*continue the same turn/i);
  assert.match(prompt.systemPrompt, /subagent_supervisor/);

  assert.deepEqual([...harness.commands.keys()], ["minions", "minions-lb"]);
  await harness.commands.get("minions").handler("build this");
  await harness.commands.get("minions-lb").handler("");
  assert.deepEqual(harness.sentUserMessages, [
    "/skill:pi-minions build this",
    "/skill:pi-minions-lb",
  ]);
});

test("Paseo failures stay provisional, retain writer leases, and can return to running", async () => {
  let clock = 10_000;
  let status = "running";
  let lastError;
  let execution = 1;
  const calls = [];
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      if (method === "spawn") return { details: { asyncId: `paseo:child-${execution}`, runtimeAgentId: `child-${execution++}` } };
      if (method === "status") {
        const snapshot = {
          status,
          lastError,
          updatedAt: new Date(clock).toISOString(),
          lastActivityAt: new Date(clock).toISOString(),
          lastUsage: { inputTokens: 10, cachedInputTokens: 20, outputTokens: 2, totalCostUsd: 0.01 },
        };
        return {
          text: `State: ${status === "running" ? "running" : "failed"}${lastError ? `\nError: ${lastError}` : ""}`,
          details: {
            snapshot,
            ...(status === "idle" ? {
              completion: {
                runId: params.runId,
                state: "failed",
                success: false,
                error: lastError,
                endedAt: clock,
              },
            } : {}),
          },
        };
      }
      if (method === "stop") return { state: "stopping" };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const harness = createHarness({ dependencies: {
    paseoRuntime,
    now: () => clock,
    paseoErrorSettleMs: 120_000,
    setWatchdogInterval: () => ({ unref() {} }),
    clearWatchdogInterval: () => {},
  } });
  await start(harness);
  const spawned = await spawn(harness, [{ role: "implementer", task: "Implement", cwd: "/repo/.worktrees/shared" }]);
  const worker = spawned.details.workers[0];

  status = "idle";
  lastError = "context window exceeded";
  let read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "settling");
  assert.match(read.content[0].text, /provisional/i);
  await assert.rejects(spawn(harness, [{ role: "architect", task: "Unsafe reuse", cwd: "/repo/.worktrees/shared" }]), /worktree is leased/i);

  clock += 60_000;
  status = "running";
  lastError = undefined;
  read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "in-flight");

  status = "idle";
  lastError = "websocket closed";
  read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "settling");
  await execute(harness.tools.get("minions_stop"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(calls.filter((call) => call.method === "stop").length, 1);
});

test("model-aware watchdog stops expensive Sol workers and blocks over-budget runs", async () => {
  const calls = [];
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      if (method === "spawn") return { details: { asyncId: "paseo:sol:run-1", runtimeAgentId: "sol" } };
      if (method === "status") return {
        text: "State: running",
        details: {
          snapshot: {
            status: "running",
            lastUsage: { inputTokens: 100, cachedInputTokens: 1_000, outputTokens: 20, totalCostUsd: 61 },
          },
        },
      };
      if (method === "stop") return { state: "stopping" };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const harness = createHarness({ dependencies: {
    paseoRuntime,
    runCostCeilingUsd: 10,
    setWatchdogInterval: () => ({ unref() {} }),
    clearWatchdogInterval: () => {},
  } });
  await start(harness);
  const spawned = await spawn(harness, [{
    role: "architect",
    task: "Complex Sol fix",
    cwd: "/repo/.worktrees/sol",
  }]);
  const worker = spawned.details.workers[0];
  assert.equal(worker.maxCostUsd, 60);
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "stopping");
  assert.match(read.details.workers[0].budgetStopReason, /cost ceiling/i);
  assert.equal(calls.filter((call) => call.method === "stop").length, 1);
  await assert.rejects(spawn(harness, [{ role: "explorer", task: "Too expensive" }]), /run reached its.*cost ceiling/i);
});

test("review workers load Matt's code-review discipline and use the nested-capable adapter", async () => {
  const harness = createHarness({ loadedDisciplines: ["code-review"] });
  await start(harness);
  await spawn(harness, [{
    role: "reviewer",
    task: "Discipline: load code-review if available.\nFixed point: main",
  }]);
  const params = harness.runtime.byMethod("spawn")[0].params;
  assert.equal(params.agent, "pi-minions-reviewer");
  assert.equal(params.skill, "code-review");
});

test("blank model overrides fall back and Paseo ignores ordinary-Pi deadlines", async () => {
  const calls = [];
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") {
        return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      }
      if (method === "spawn") {
        return {
          details: {
            asyncId: "paseo:child-hotfix:execution-1",
            runtimeAgentId: "child-hotfix",
          },
        };
      }
      throw new Error(`Unexpected Paseo method: ${method}`);
    },
  };
  const harness = createHarness({
    provider: "github-copilot",
    dependencies: { paseoRuntime },
  });
  await start(harness);
  const result = await spawn(harness, [{
    role: "mechanical",
    task: "Inspect issue",
    routeOverride: "mechanical-judgment",
    overrideReason: "github-judgment",
    modelOverride: "   ",
    timeoutSeconds: 900,
    maxDurationSeconds: 1800,
  }]);

  const spawnCall = calls.find((call) => call.method === "spawn");
  assert.equal(spawnCall.params.model, "github-copilot/gpt-5.6-terra:max");
  assert.equal(Object.hasOwn(spawnCall.params, "timeoutMs"), false);
  assert.equal(result.details.workers[0].timeoutSeconds, 900);
  assert.equal(result.details.workers[0].timeoutSecondsIgnored, true);
  assert.equal(result.details.workers[0].maxDurationSeconds, 180 * 60);
  assert.match(result.content[0].text, /Ignored timeoutSeconds for 1 Paseo worker/);
  assert.match(result.content[0].text, /Do not retry with timeoutSeconds/);

  const incidentRegression = await spawn(harness, [{
    role: "implementer",
    task: "Implement one bounded slice",
    cwd: "/repo/.worktrees/paseo-timeout-regression",
    timeoutSeconds: 30,
  }]);
  assert.equal(incidentRegression.details.workers[0].timeoutSecondsIgnored, true);
  assert.equal(incidentRegression.details.workers[0].maxDurationSeconds, 180 * 60);
});

test("Orca sessions use native orchestration identities without dispatching pi-subagents", async () => {
  const calls = [];
  let dispatch = 1;
  let state = "running";
  const orcaRuntime = {
    kind: "orca",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") {
        return {
          runtime: "orca",
          runId: "run-orca-1",
          methods: ["ping", "status", "spawn", "steer", "stop", "resume", "release"],
        };
      }
      if (method === "spawn") {
        return {
          details: {
            asyncId: `orca:dispatch-${dispatch}`,
            runtimeAgentId: `dispatch-${dispatch++}`,
            runtimeTerminalId: "term-worker-1",
            runtimeTaskId: "task-1",
          },
        };
      }
      if (method === "status") {
        return {
          text: `State: ${state}`,
          details: state === "complete" ? {
            completion: {
              id: params.runId,
              runId: params.runId,
              state: "complete",
              success: true,
              summary: "Orca worker finished",
            },
          } : {},
        };
      }
      if (method === "resume") {
        return {
          details: {
            asyncId: `orca:dispatch-${dispatch}`,
            runtimeAgentId: `dispatch-${dispatch++}`,
            runtimeTerminalId: params.terminalId,
            runtimeTaskId: "task-2",
          },
        };
      }
      if (method === "steer") return { text: "Orca accepted guidance." };
      if (method === "stop") return { state: "stopping" };
      if (method === "release") return { state: "released" };
      throw new Error(`Unexpected Orca method: ${method}`);
    },
  };
  const harness = createHarness({ dependencies: {
    orcaRuntime,
    setWatchdogInterval: () => ({ unref() {} }),
    clearWatchdogInterval: () => {},
  } });
  const started = await start(harness);
  assert.equal(started.details.runtime, "orca");
  assert.match(started.content[0].text, /Orca native orchestration/);
  assert.equal(harness.runtime.byMethod("ping").length, 0);
  const blockedBypass = harness.handlers.get("tool_call")({
    toolName: "bash",
    input: { command: "orca orchestration worker-start --task task-1 --worktree current --agent pi --json" },
  });
  const allowedInspection = harness.handlers.get("tool_call")({
    toolName: "bash",
    input: { command: "orca orchestration worker-show --dispatch dispatch-1 --json" },
  });
  assert.equal(blockedBypass.block, true);
  assert.match(blockedBypass.reason, /bypass Minions/);
  assert.equal(allowedInspection, undefined);

  const spawned = await spawn(harness, [{
    role: "explorer",
    task: "Inspect",
    timeoutSeconds: 30,
  }]);
  const worker = spawned.details.workers[0];
  assert.equal(worker.runtimeAgentId, "dispatch-1");
  assert.equal(worker.runtimeTerminalId, "term-worker-1");
  assert.equal(worker.runtimeTaskId, "task-1");
  assert.equal(worker.timeoutSecondsIgnored, true);
  assert.match(spawned.content[0].text, /Ignored timeoutSeconds for 1 Orca worker/);
  const persisted = harness.appendedEntries.at(-1).data;
  assert.equal(persisted.runtime, "orca");
  assert.equal(persisted.runtimeRunId, "run-orca-1");
  assert.equal(harness.runtime.byMethod("spawn").length, 0);

  state = "complete";
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "done");
  assert.match(read.content[0].text, /Orca worker finished/);
  const statusCall = calls.find((call) => call.method === "status");
  assert.equal(statusCall.params.id, "dispatch-1");
  assert.equal(statusCall.params.terminalId, "term-worker-1");

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: worker.id,
    message: "Continue",
  }, harness.ctx);
  assert.equal(resumed.details.worker.runtimeAgentId, "dispatch-2");
  assert.equal(resumed.details.worker.runtimeTerminalId, "term-worker-1");
  const resumeCall = calls.find((call) => call.method === "resume");
  assert.equal(resumeCall.params.agent, "pi-minions-explorer");
  assert.equal(resumeCall.params.model, "openai-codex/gpt-5.6-luna:high");

  await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.deepEqual(closed.details.disposedWorkerIds, [worker.id]);
  const releaseCall = calls.find((call) => call.method === "release");
  assert.equal(releaseCall.params.id, "dispatch-2");
  assert.equal(releaseCall.params.terminalId, "term-worker-1");
});

test("Paseo sessions use native child agents without dispatching pi-subagents", async () => {
  const calls = [];
  let execution = 1;
  let state = "running";
  let cumulativeUsage = { input: 10, cacheRead: 3, output: 2, costUsd: 0.02 };
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") {
        return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      }
      if (method === "spawn") {
        return {
          details: {
            asyncId: `paseo:child-1:execution-${execution++}`,
            runtimeAgentId: "child-1",
          },
        };
      }
      if (method === "status") {
        return {
          text: `State: ${state}`,
          details: state === "complete" ? {
            completion: {
              id: params.runId,
              runId: params.runId,
              state: "complete",
              success: true,
              summary: "Paseo child finished",
              totalTokens: {
                input: cumulativeUsage.input,
                cacheRead: cumulativeUsage.cacheRead,
                output: cumulativeUsage.output,
                total: cumulativeUsage.input + cumulativeUsage.cacheRead + cumulativeUsage.output,
              },
              totalCost: {
                inputTokens: cumulativeUsage.input,
                outputTokens: cumulativeUsage.output,
                costUsd: cumulativeUsage.costUsd,
              },
            },
          } : {},
        };
      }
      if (method === "resume") {
        return {
          details: {
            asyncId: `paseo:child-1:execution-${execution++}`,
            runtimeAgentId: "child-1",
          },
        };
      }
      if (method === "steer") return { text: "Prompt sent." };
      if (method === "stop") return { state: "stopping" };
      throw new Error(`Unexpected Paseo method: ${method}`);
    },
  };
  const harness = createHarness({ dependencies: { paseoRuntime } });
  const started = await start(harness);
  assert.equal(started.details.runtime, "paseo");
  assert.match(started.content[0].text, /Paseo native agents/);
  assert.equal(harness.runtime.byMethod("ping").length, 0);

  const spawned = await spawn(harness, [{ role: "explorer", task: "Inspect" }]);
  const worker = spawned.details.workers[0];
  assert.equal(worker.runtimeAgentId, "child-1");
  const persisted = harness.appendedEntries.at(-1).data;
  assert.equal(persisted.runtime, "paseo");
  assert.equal(persisted.workers[0].runtimeAgentId, "child-1");
  assert.equal(harness.runtime.byMethod("spawn").length, 0);
  assert.equal(calls.find((call) => call.method === "spawn").params.model, "openai-codex/gpt-5.6-luna:high");

  state = "complete";
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [worker.id] }, harness.ctx);
  assert.equal(read.details.workers[0].status, "done");
  assert.match(read.content[0].text, /Paseo child finished/);
  assert.equal(read.usage.cacheRead, 3);
  assert.equal(read.usage.totalTokens, 15);
  const statusCall = calls.find((call) => call.method === "status");
  assert.equal(statusCall.params.id, "child-1");
  assert.equal(statusCall.params.runId, worker.subagentRunId);

  const resumed = await execute(harness.tools.get("minions_resume"), {
    workerId: worker.id,
    message: "Continue",
  }, harness.ctx);
  assert.equal(resumed.details.worker.runtimeAgentId, "child-1");
  assert.notEqual(resumed.details.worker.subagentRunId, worker.subagentRunId);
  const resumeCall = calls.find((call) => call.method === "resume");
  assert.equal(resumeCall.params.id, "child-1");

  cumulativeUsage = { input: 16, cacheRead: 8, output: 5, costUsd: 0.05 };
  const resumedRead = await execute(harness.tools.get("minions_read"), {
    workerIds: [worker.id],
  }, harness.ctx);
  assert.deepEqual(resumedRead.usage, {
    input: 6,
    output: 3,
    cacheRead: 5,
    cacheWrite: 0,
    totalTokens: 14,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  });
  assert.equal(resumedRead.details.workers[0].usage.cost.total, 0.05);
  assert.equal(resumedRead.details.workers[0].usage.totalTokens, 29);
});

test("Paseo close disposes only run-owned terminal workers and records partial cleanup", async () => {
  const calls = [];
  let nextChild = 1;
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "stop", "resume", "release"] };
      if (method === "spawn") {
        const childId = `child-${nextChild++}`;
        return { details: { asyncId: `paseo:${childId}:execution-1`, runtimeAgentId: childId } };
      }
      if (method === "status") {
        return {
          text: "State: complete",
          details: {
            snapshot: { status: "idle", pendingPermissions: [] },
            completion: { runId: params.runId, state: "complete", success: true, summary: "Done" },
          },
        };
      }
      if (method === "release") {
        if (params.id === "child-2") throw new Error("archive backend unavailable");
        return { state: "released" };
      }
      throw new Error(`Unexpected Paseo method: ${method}`);
    },
  };
  const harness = createHarness({ dependencies: { paseoRuntime } });
  await start(harness);
  const spawned = await spawn(harness, [
    { role: "explorer", task: "Inspect A" },
    { role: "reviewer", task: "Inspect B" },
  ]);
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);

  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.deepEqual(calls.filter((call) => call.method === "release").map((call) => call.params.id), ["child-1", "child-2"]);
  assert.deepEqual(closed.details.disposedWorkerIds, [spawned.details.workers[0].id]);
  assert.deepEqual(closed.details.disposalFailures.map((failure) => failure.workerId), [spawned.details.workers[1].id]);
  assert.match(closed.content[0].text, /Disposal failures: 1/);
  const finalWorkers = harness.appendedEntries.at(-1).data.workers;
  assert.equal(finalWorkers[0].disposition, "disposed");
  assert.equal(finalWorkers[1].disposition, "disposal-failed");
});

test("handoff preservation keeps only listed Paseo workers out of disposal", async () => {
  const calls = [];
  let nextChild = 1;
  const paseoRuntime = {
    kind: "paseo",
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "stop", "resume", "release"] };
      if (method === "spawn") {
        const childId = `child-handoff-${nextChild++}`;
        return { details: { asyncId: `paseo:${childId}:execution-1`, runtimeAgentId: childId } };
      }
      if (method === "status") {
        return {
          text: "State: complete",
          details: {
            snapshot: { status: "idle", pendingPermissions: [] },
            completion: { runId: params.runId, state: "complete", success: true, summary: "Done" },
          },
        };
      }
      if (method === "release") return { state: "released" };
      throw new Error(`Unexpected Paseo method: ${method}`);
    },
  };
  const harness = createHarness({ dependencies: { paseoRuntime } });
  await start(harness);
  const spawned = await spawn(harness, [
    { role: "architect", task: "Prepare handoff", cwd: "/repo/.worktrees/handoff" },
    { role: "reviewer", task: "Review handoff" },
  ]);
  const [retained, disposable] = spawned.details.workers;
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  const closed = await execute(harness.tools.get("minions_close"), {
    workerPolicy: "preserve",
    preserveWorkerIds: [retained.id],
  }, harness.ctx);

  assert.deepEqual(calls.filter((call) => call.method === "release").map((call) => call.params.id), ["child-handoff-2"]);
  assert.deepEqual(closed.details.preservedWorkerIds, [retained.id]);
  assert.deepEqual(closed.details.disposedWorkerIds, [disposable.id]);
  assert.equal(closed.details.workerRetention, "preserve-for-handoff");
  assert.deepEqual(harness.appendedEntries.at(-1).data.workers.map((worker) => worker.disposition), ["preserved", "disposed"]);
});

// ---------------------------------------------------------------------------
// Issue #42: CommandCode GOAT provider routing with DeepSeek V4 Flash 0731 and
// Muse fallback.
// ---------------------------------------------------------------------------

const COMMANDCODE_CATALOG = [
  "gpt-5.6-luna",
  "deepseek/deepseek-v4-flash",
  "moonshotai/Kimi-K3",
  "meta/muse-spark-1.2-contributor",
  "xai/grok-4.5",
];

test("commandcode is accepted as a provider and start selects the matrix frontier", async () => {
  const harness = createHarness({ provider: "commandcode" });
  const result = await start(harness);

  assert.match(result.content[0].text, /Provider Affinity commandcode/);
  assert.deepEqual(harness.modelChanges, [{ provider: "commandcode", id: "gpt-5.6-luna" }]);
  assert.deepEqual(harness.thinkingChanges, ["max"]);
  assert.equal(result.details.frontier, "gpt-5.6-luna");
  assert.equal(result.details.thinking, "max");

  const lbHarness = createHarness({ provider: "commandcode" });
  const lbResult = await start(lbHarness, "lb");
  assert.equal(lbResult.details.frontier, "gpt-5.6-luna");
  assert.equal(lbResult.details.thinking, "xhigh");
  assert.deepEqual(lbHarness.thinkingChanges, ["xhigh"]);
});

test("commandcode start preflights required vs optional models", async () => {
  // Missing optional models (Kimi/Muse/Grok) is not fatal: the run still starts.
  const optionalMissing = createHarness({
    provider: "commandcode",
    missingModels: ["moonshotai/Kimi-K3", "meta/muse-spark-1.2-contributor", "xai/grok-4.5"],
  });
  const started = await start(optionalMissing);
  assert.match(started.content[0].text, /Optional model\(s\) unavailable/);
  assert.deepEqual(started.details.missingOptionalModels.sort(), [
    "meta/muse-spark-1.2-contributor",
    "moonshotai/Kimi-K3",
    "xai/grok-4.5",
  ]);

  // Missing DeepSeek (required) rejects the run.
  const requiredMissing = createHarness({
    provider: "commandcode",
    missingModels: ["deepseek/deepseek-v4-flash"],
  });
  await assert.rejects(start(requiredMissing), /missing required model.*deepseek\/deepseek-v4-flash/);
  assert.equal(requiredMissing.runtime.byMethod("ping").length, 0);
});

test("commandcode standard routes honor the Luna xhigh and DeepSeek max floors", async () => {
  const cases = [
    { role: "mechanical", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
    { role: "explorer", expected: "commandcode/gpt-5.6-luna:xhigh" },
    { role: "implementer", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
    { role: "architect", expected: "commandcode/gpt-5.6-luna:max" },
    { role: "reviewer", expected: "commandcode/gpt-5.6-luna:max" },
    { role: "planner", expected: "commandcode/gpt-5.6-luna:max" },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: "commandcode" });
    await start(harness);
    await spawn(harness, [{
      role: entry.role,
      task: entry.role,
      ...(["implementer", "architect"].includes(entry.role) ? { cwd: `/repo/.worktrees/${entry.role}` } : {}),
    }]);
    assert.equal(harness.runtime.byMethod("spawn")[0].params.model, entry.expected);
  }
});

test("commandcode lb routes use DeepSeek max workhorse and Luna xhigh floors", async () => {
  const cases = [
    { role: "mechanical", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
    { role: "explorer", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
    { role: "implementer", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
    { role: "architect", expected: "commandcode/gpt-5.6-luna:xhigh" },
    { role: "reviewer", expected: "commandcode/gpt-5.6-luna:xhigh" },
    { role: "planner", expected: "commandcode/deepseek/deepseek-v4-flash:max" },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: "commandcode" });
    await start(harness, "lb");
    await spawn(harness, [{
      role: entry.role,
      task: entry.role,
      ...(["implementer", "architect"].includes(entry.role) ? { cwd: `/repo/.worktrees/lb-${entry.role}` } : {}),
    }]);
    assert.equal(harness.runtime.byMethod("spawn")[0].params.model, entry.expected);
  }
});

test("Muse and Grok are not used by any normal automatic route", async () => {
  // LB implementer must be DeepSeek, never Muse, and no route may select Muse/Grok
  // automatically even when they are present in the catalog.
  const harness = createHarness({ provider: "commandcode" });
  await start(harness, "lb");
  const spawned = await spawn(harness, [{
    role: "implementer",
    task: "Implement",
    cwd: "/repo/.worktrees/lb-implementer",
  }]);
  assert.equal(spawned.details.workers[0].model, "deepseek/deepseek-v4-flash");
  assert.equal(harness.runtime.byMethod("spawn")[0].params.model, "commandcode/deepseek/deepseek-v4-flash:max");
});

test("CommandCode API/plan errors surface as actionable errors, not generic failures", async () => {
  const paseoRuntime = {
    kind: "paseo",
    async call(method) {
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      if (method === "spawn") throw new Error("401 unauthorized: CMD_API_KEY is invalid");
      if (method === "status") return { text: "State: running", details: { snapshot: { status: "running" } } };
      if (method === "stop") return { state: "stopping" };
      throw new Error(`Unexpected Paseo method ${method}`);
    },
  };
  const harness = createHarness({
    provider: "commandcode",
    dependencies: {
      paseoRuntime,
      setWatchdogInterval: () => ({ unref() {} }),
      clearWatchdogInterval: () => {},
    },
  });
  await start(harness);
  await assert.rejects(spawn(harness, [{
    role: "mechanical",
    task: "Bounded task",
  }]), /CommandCode rejected the API key\/plan \(401\/403\).*CMD_API_KEY/i);
});

test("CommandCode transient upstream failures surface as actionable retry guidance", async () => {
  const paseoRuntime = {
    kind: "paseo",
    async call(method) {
      if (method === "ping") return { runtime: "paseo", methods: ["ping", "status", "spawn", "steer", "stop", "resume"] };
      if (method === "spawn") throw new Error("upstream 503 temporarily unavailable");
      if (method === "status") return { text: "State: running", details: { snapshot: { status: "running" } } };
      if (method === "stop") return { state: "stopping" };
      throw new Error(`Unexpected Paseo method ${method}`);
    },
  };
  const harness = createHarness({
    provider: "commandcode",
    dependencies: {
      paseoRuntime,
      setWatchdogInterval: () => ({ unref() {} }),
      clearWatchdogInterval: () => {},
    },
  });
  await start(harness);
  await assert.rejects(spawn(harness, [{
    role: "mechanical",
    task: "Bounded task",
  }]), /CommandCode upstream is rate-limited or temporarily unavailable.*retry shortly/i);
});

test("explicit deepseek/meta/moonshotai/xai model overrides are authorized from raw input", async () => {
  const cases = [
    { id: "deepseek/deepseek-v4-flash" },
    { id: "moonshotai/Kimi-K3" },
    { id: "meta/muse-spark-1.2-contributor" },
    { id: "xai/grok-4.5" },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: "commandcode" });
    await start(harness, "standard", `/skill:pi-minions usa ${entry.id} per il prossimo batch`);
    const result = await spawn(harness, [{
      role: "reviewer",
      task: "Review with override",
      modelOverride: entry.id,
    }]);
    assert.equal(result.details.workers[0].modelOverride, entry.id);
    const spawnedModel = harness.runtime.byMethod("spawn")[0].params.model;
    assert.match(spawnedModel, new RegExp(`commandcode/${entry.id}:`));
  }
});

test("unauthorized model overrides are still rejected and downgraded", async () => {
  const harness = createHarness({ provider: "commandcode" });
  await start(harness);
  const result = await spawn(harness, [{
    role: "mechanical",
    task: "Use unrequested model",
    modelOverride: "gpt-5.6-luna",
  }]);
  assert.equal(result.details.workers[0].modelOverride, undefined);
  assert.match(result.details.workers[0].modelOverrideRejection, /not explicitly requested by the user/i);
  assert.equal(harness.runtime.byMethod("spawn")[0].params.model, "commandcode/deepseek/deepseek-v4-flash:max");
});

test("CommandCode model budget/watchdog profiles apply to every new model", async () => {
  const cases = [
    { role: "mechanical", model: "deepseek/deepseek-v4-flash", max: 60, warning: 40, duration: 210 * 60, goatAllowanceUsd: 60, goatMeterFactor: 70 / 60 },
    { role: "explorer", model: "gpt-5.6-luna", max: 24, warning: 16, duration: 180 * 60, goatAllowanceUsd: 70, goatMeterFactor: 1.0 },
    { role: "planner", model: "gpt-5.6-luna", max: 24, warning: 16, duration: 180 * 60, goatAllowanceUsd: 70, goatMeterFactor: 1.0 },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: "commandcode" });
    await start(harness);
    const spawned = await spawn(harness, [{ role: entry.role, task: entry.role }]);
    assert.equal(spawned.details.workers[0].model, entry.model);
    assert.equal(spawned.details.workers[0].maxCostUsd, entry.max);
    assert.equal(spawned.details.workers[0].warningCostUsd, entry.warning);
    assert.equal(spawned.details.workers[0].maxDurationSeconds, entry.duration);
    assert.equal(harness.appendedEntries.at(-1).data.workers[0].maxCostUsd, entry.max);
  }

  // GOAT-aware metadata is available for all CommandCode models without assuming a
  // shared $70 pool (Kimi/Muse/Grok are $20-allowance and erode the meter ~3.5x).
  const budgets = createHarness({ provider: "commandcode" });
  await start(budgets);
  const worker = (await spawn(budgets, [{ role: "mechanical", task: "budget" }])).details.workers[0];
  assert.equal(worker.model, "deepseek/deepseek-v4-flash");
  assert.equal(budgets.appendedEntries.at(-1).data.workers[0].model, "deepseek/deepseek-v4-flash");
});

test("model lock restores the configured CommandCode frontier during an active run", async () => {
  const harness = createHarness({ provider: "commandcode" });
  await start(harness);
  await harness.handlers.get("model_select")({ model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" } }, harness.ctx);
  harness.handlers.get("thinking_level_select")({ level: "high" }, harness.ctx);
  assert.deepEqual(harness.modelChanges.at(-1), { provider: "commandcode", id: "gpt-5.6-luna" });
  assert.equal(harness.thinkingChanges.at(-1), "max");

  const lb = createHarness({ provider: "commandcode" });
  await start(lb, "lb");
  await lb.handlers.get("model_select")({ model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" } }, lb.ctx);
  lb.handlers.get("thinking_level_select")({ level: "high" }, lb.ctx);
  assert.deepEqual(lb.modelChanges.at(-1), { provider: "commandcode", id: "gpt-5.6-luna" });
  assert.equal(lb.thinkingChanges.at(-1), "xhigh");
});

test("CommandCode start warns when CMD_API_KEY is missing and never persists it", async () => {
  const previous = process.env.CMD_API_KEY;
  delete process.env.CMD_API_KEY;
  try {
    const harness = createHarness({ provider: "commandcode" });
    const started = await start(harness);
    const keyNotification = harness.notifications.find((n) => /CMD_API_KEY/.test(n.message));
    assert.equal(Boolean(keyNotification), true);
    assert.match(keyNotification.message, /api\.commandcode\.ai/); // help text mentions the endpoint
    // The key is never persisted in state or spawn payloads.
    const serialized = JSON.stringify(harness.appendedEntries);
    assert.equal(serialized.includes("CMD_API_KEY"), false);
    assert.equal(started.details.frontier, "gpt-5.6-luna");
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});
