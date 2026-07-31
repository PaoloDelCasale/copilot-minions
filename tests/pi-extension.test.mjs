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
  const handlers = new Map();
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
    ? ["gpt-5.6-sol", "gpt-5.6-terra", "grok-4.5"]
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
    validateWriterCwd: () => true,
    resolveDiscipline: (name) => loadedDisciplines.includes(name),
    ...dependencies,
  });
  return {
    pi,
    runtime,
    tools,
    handlers,
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

async function start(harness, variant = "standard") {
  return execute(harness.tools.get("minions_start"), { variant }, harness.ctx);
}

async function spawn(harness, tasks) {
  return execute(harness.tools.get("minions_spawn"), { tasks }, harness.ctx);
}

test("the extension registers TypeBox schemas for every public Minions tool", () => {
  const harness = createHarness();
  assert.equal(Value.Check(harness.tools.get("minions_start").parameters, { variant: "standard" }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "explorer", task: "Inspect", timeoutSeconds: 30 }],
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_resume").parameters, {
    workerId: "worker-1",
    message: "Continue",
  }), true);
  assert.equal(Value.Check(harness.tools.get("minions_spawn").parameters, {
    tasks: [{ role: "unknown", task: "Inspect" }],
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

  const missingCopilot = createHarness({
    provider: "github-copilot",
    missingModels: ["grok-4.5"],
  });
  await assert.rejects(start(missingCopilot), /missing required model.*grok-4\.5/);
  assert.equal(missingCopilot.runtime.byMethod("ping").length, 0);
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

test("spawn preflights the entire batch before starting any child", async () => {
  const harness = createHarness();
  await start(harness);
  await assert.rejects(spawn(harness, [
    { role: "explorer", task: "Explore" },
    { role: "implementer", task: "Implement", cwd: "/repo/.worktrees/t1", modelOverride: "missing" },
  ]), /does not offer requested model missing/);
  assert.equal(harness.runtime.byMethod("spawn").length, 0);
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
    { provider: "openai-codex", variant: "lb", role: "architect", expected: "openai-codex/gpt-5.6-luna:high" },
    { provider: "github-copilot", variant: "standard", role: "mechanical", expected: "github-copilot/grok-4.5:high" },
    { provider: "github-copilot", variant: "lb", role: "reviewer", expected: "github-copilot/gpt-5.6-sol:low" },
  ];
  for (const entry of cases) {
    const harness = createHarness({ provider: entry.provider });
    await start(harness, entry.variant);
    await spawn(harness, [{
      role: entry.role,
      task: entry.role,
      ...(entry.role === "architect" ? { cwd: "/repo/.worktrees/a" } : {}),
    }]);
    assert.equal(harness.runtime.byMethod("spawn")[0].params.model, entry.expected);
  }
});

test("named escalation routes retain their exact model and effort", async () => {
  const harness = createHarness();
  await start(harness);
  await spawn(harness, [{
    role: "implementer",
    task: "Retry",
    cwd: "/repo/.worktrees/retry",
    routeOverride: "escalate-sol-max",
  }]);
  assert.equal(harness.runtime.byMethod("spawn")[0].params.model, "openai-codex/gpt-5.6-sol:max");
});

test("the wrapper enforces six concurrent workers and the eight-result triage handoff", async () => {
  const harness = createHarness();
  await start(harness);
  const paused = await spawn(harness, [{ role: "reviewer", task: "Pause me" }]);
  const pausedWorker = paused.details.workers[0];
  harness.runtime.complete(pausedWorker.subagentRunId, { success: false, state: "paused", summary: "Need another pass" });
  const six = Array.from({ length: 6 }, (_, index) => ({ role: "explorer", task: `Explore ${index}` }));
  const live = await spawn(harness, six);
  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: pausedWorker.id,
    message: "Resume despite full live capacity",
  }, harness.ctx), /at most 6 in-flight/);
  assert.equal(harness.runtime.byMethod("resume").length, 0);

  for (const worker of live.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
  const eighth = await spawn(harness, [{ role: "planner", task: "Eighth result" }]);
  harness.runtime.complete(eighth.details.workers[0].subagentRunId, { summary: "done" });
  await execute(harness.tools.get("minions_read"), {}, harness.ctx);
  await assert.rejects(execute(harness.tools.get("minions_resume"), {
    workerId: pausedWorker.id,
    message: "Resume after triage handoff",
  }, harness.ctx), /8-result triage budget/);
  assert.equal(harness.runtime.byMethod("resume").length, 0);
  const spawnCalls = harness.runtime.byMethod("spawn").length;
  await assert.rejects(spawn(harness, [{ role: "planner", task: "Ninth result" }]), /8-result triage budget/);
  assert.equal(harness.runtime.byMethod("spawn").length, spawnCalls);
});

test("the wrapper enforces the twelve-launch worker budget even when results are unread", async () => {
  const harness = createHarness();
  await start(harness);
  for (let batch = 0; batch < 2; batch += 1) {
    const result = await spawn(harness, Array.from({ length: 6 }, (_, index) => ({
      role: "explorer",
      task: `Batch ${batch} task ${index}`,
    })));
    for (const worker of result.details.workers) harness.runtime.complete(worker.subagentRunId, { summary: "done" });
  }
  await assert.rejects(spawn(harness, [{ role: "planner", task: "Thirteenth" }]), /at most 12 worker launches/);
});

test("partial successes consume their launch budget before the stop lifecycle completes", async () => {
  const harness = createHarness({ runtimeOptions: { failSpawnAt: 11 } });
  await start(harness);
  for (const size of [6, 4]) {
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
  ]), /at most 12 worker launches/);
  assert.equal(harness.runtime.byMethod("spawn").length, 12);
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
  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.match(closed.content[0].text, /Closed orchestration/);
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

test("close restores the original provider model and flushes unread usage", async () => {
  const harness = createHarness({ provider: "github-copilot", modelId: "gpt-4.1" });
  await start(harness);
  const spawned = await spawn(harness, [{ role: "explorer", task: "Explore" }]);
  harness.runtime.complete(spawned.details.workers[0].subagentRunId, {
    totalTokens: { input: 10, output: 2, total: 12 },
    totalCost: { inputTokens: 10, outputTokens: 2, costUsd: 0.03 },
  });

  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);
  assert.deepEqual(harness.modelChanges.at(-1), { provider: "github-copilot", id: "gpt-4.1" });
  assert.equal(harness.thinkingChanges.at(-1), "high");
  assert.equal(closed.usage.totalTokens, 12);
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
  const spawned = await spawn(first, [{ role: "explorer", task: "Long inspection" }]);
  first.handlers.get("session_shutdown")({ reason: "reload" }, first.ctx);
  const saved = [...first.sessionEntries];
  assert.equal(first.events.handlers.get(ASYNC_COMPLETE)?.size ?? 0, 0);

  const second = createHarness({ sessionEntries: saved });
  second.handlers.get("session_start")({ reason: "reload" }, second.ctx);
  const startAgain = await start(second);

  assert.match(startAgain.content[0].text, /already active/);
  assert.equal(saved.filter((entry) => entry.customType === "pi-minions-state").at(-1).data.workers[0].subagentRunId, spawned.details.workers[0].subagentRunId);
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

test("Pi aliases and the system prompt keep top-level dispatch on Minions", () => {
  const harness = createHarness();
  const transformed = harness.handlers.get("input")({
    source: "user",
    text: "/skill:codex-minions build this",
  });
  const prompt = harness.handlers.get("before_agent_start")({ systemPrompt: "base" }, harness.ctx);
  assert.equal(transformed.text, "/skill:pi-minions build this");
  assert.match(prompt.systemPrompt, /never call the generic subagent tool directly/i);
  assert.match(prompt.systemPrompt, /subagent_supervisor/);
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
