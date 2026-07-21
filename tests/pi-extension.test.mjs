import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createPiMinionsExtension } from "../extensions/pi-minions/orchestrator.mjs";

function createHarness({ provider = "openai-codex", modelId = "gpt-5.4", dependencies = {}, missingModels = [] } = {}) {
  const tools = new Map();
  const handlers = new Map();
  const modelChanges = [];
  const thinkingChanges = [];
  const sentMessages = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { handlers.set(name, handler); },
    async setModel(model) { modelChanges.push(model); return true; },
    setThinkingLevel(level) { thinkingChanges.push(level); },
    getThinkingLevel() { return "high"; },
    sendMessage(message, options) { sentMessages.push({ message, options }); },
    appendEntry() {},
  };
  const models = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]
    .filter((id) => !missingModels.includes(id))
    .map((id) => ({ provider, id }));
  const ctx = {
    cwd: "/repo",
    model: { provider, id: modelId },
    modelRegistry: {
      find(candidateProvider, id) {
        return models.find((model) => model.provider === candidateProvider && model.id === id);
      },
    },
    isProjectTrusted() { return true; },
    ui: { notify() {}, setStatus() {} },
    sessionManager: { getSessionId() { return "parent-session"; } },
  };
  createPiMinionsExtension(pi, { schemas: {}, ...dependencies });
  return { pi, tools, handlers, ctx, modelChanges, thinkingChanges, sentMessages };
}

async function execute(tool, params, ctx) {
  return tool.execute("call-1", params, undefined, undefined, ctx);
}

test("start captures Provider Affinity and selects the standard frontier route", async () => {
  const harness = createHarness();

  const result = await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);

  assert.match(result.content[0].text, /openai-codex/);
  assert.deepEqual(harness.modelChanges, [{ provider: "openai-codex", id: "gpt-5.6-sol" }]);
  assert.deepEqual(harness.thinkingChanges, ["medium"]);
});

function fakeRpcProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = { writes: [], write(value) { this.writes.push(value); } };
  process.kills = [];
  process.kill = (signal) => { process.kills.push(signal); return true; };
  return process;
}

test("start rejects providers outside the supported Provider Affinity boundary", async () => {
  const harness = createHarness({ provider: "anthropic" });

  await assert.rejects(
    execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx),
    /Unsupported provider: anthropic/,
  );
  assert.equal(harness.modelChanges.length, 0);
});

test("start fails preflight instead of changing the Role Routing", async () => {
  const harness = createHarness({ missingModels: ["gpt-5.6-terra"] });

  await assert.rejects(
    execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx),
    /missing required model\(s\): gpt-5.6-terra/,
  );
});

test("spawn starts an ephemeral trusted RPC worker on the role route", async () => {
  const spawns = [];
  const process = fakeRpcProcess();
  const harness = createHarness({
    dependencies: {
      spawnProcess(command, args, options) {
        spawns.push({ command, args, options });
        return process;
      },
      piInvocation: { command: "pi", args: [] },
    },
  });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);

  const result = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "implementer", task: "Implement T1", cwd: "/repo/.worktrees/t1" }],
  }, harness.ctx);

  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0].args.slice(0, 10), [
    "--mode", "rpc", "--no-session", "--no-extensions", "--approve",
    "--model", "openai-codex/gpt-5.6-luna", "--thinking", "xhigh", "--tools",
  ]);
  assert.equal(spawns[0].options.cwd, "/repo/.worktrees/t1");
  assert.deepEqual(JSON.parse(process.stdin.writes[0]), { type: "prompt", message: "Implement T1" });
  assert.match(result.content[0].text, /implementer/);
});

test("mechanical judgment preserves the Terra medium route", async () => {
  const spawns = [];
  const harness = createHarness({ dependencies: {
    spawnProcess(command, args, options) { spawns.push({ command, args, options }); return fakeRpcProcess(); },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);

  await execute(harness.tools.get("minions_spawn"), { tasks: [{
    role: "mechanical",
    routeOverride: "mechanical-judgment",
    task: "Resolve the merge conflict",
  }] }, harness.ctx);

  assert.ok(spawns[0].args.includes("openai-codex/gpt-5.6-terra"));
  assert.equal(spawns[0].args[spawns[0].args.indexOf("--thinking") + 1], "medium");
});

test("worker steering, stopping, and close are exposed through managed tools", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
    setTimeout() { return 1; },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "lb" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "architect", task: "Build it" }],
  }, harness.ctx);
  const workerId = spawned.details.workers[0].id;

  await execute(harness.tools.get("minions_steer"), { workerId, message: "Narrow the scope" }, harness.ctx);
  await execute(harness.tools.get("minions_stop"), { workerIds: [workerId] }, harness.ctx);
  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);

  assert.deepEqual(child.stdin.writes.slice(1).map(JSON.parse), [
    { type: "steer", message: "Narrow the scope" },
    { type: "abort" },
  ]);
  assert.match(closed.content[0].text, /closed/i);
  assert.deepEqual(harness.modelChanges.at(-1), { provider: "openai-codex", id: "gpt-5.4" });
  assert.equal(harness.thinkingChanges.at(-1), "high");
});

test("Pi redirects Codex minion skill commands to the Pi adapter", async () => {
  const harness = createHarness();

  const standard = await harness.handlers.get("input")({ text: "/skill:codex-minions build it", source: "interactive" }, harness.ctx);
  const lowBudget = await harness.handlers.get("input")({ text: "/skill:codex-minions-lb build it", source: "interactive" }, harness.ctx);

  assert.deepEqual(standard, { action: "transform", text: "/skill:pi-minions build it" });
  assert.deepEqual(lowBudget, { action: "transform", text: "/skill:pi-minions-lb build it" });
});

test("active runs lock the frontier model and block session replacement with workers in flight", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), { tasks: [{ role: "explorer", task: "Explore" }] }, harness.ctx);

  await harness.handlers.get("model_select")({ model: { provider: "github-copilot", id: "gpt-5.6-sol" } }, harness.ctx);
  const switchResult = await harness.handlers.get("session_before_switch")({ reason: "new" }, harness.ctx);
  const forkResult = await harness.handlers.get("session_before_fork")({}, harness.ctx);

  assert.deepEqual(harness.modelChanges.at(-1), { provider: "openai-codex", id: "gpt-5.6-sol" });
  assert.deepEqual(switchResult, { cancel: true });
  assert.deepEqual(forkResult, { cancel: true });
});

test("settled workers produce one aggregated notification and are readable", async () => {
  const children = [fakeRpcProcess(), fakeRpcProcess()];
  const queue = [...children];
  const scheduled = [];
  const harness = createHarness({ dependencies: {
    spawnProcess() { return queue.shift(); },
    piInvocation: { command: "pi", args: [] },
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), { tasks: [
    { role: "explorer", task: "Explore A" },
    { role: "reviewer", task: "Review B" },
  ] }, harness.ctx);
  const ids = spawned.details.workers.map((worker) => worker.id);

  children[0].stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "A done" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  children[1].stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "B done" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.equal(scheduled.length, 1);
  scheduled[0]();

  assert.deepEqual(harness.sentMessages[0].message.details.workerIds, ids);
  const read = await execute(harness.tools.get("minions_read"), { workerIds: ids }, harness.ctx);
  assert.deepEqual(read.details.workers.map(({ status, output }) => ({ status, output })), [
    { status: "done", output: "A done" },
    { status: "done", output: "B done" },
  ]);
});
