import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createPiMinionsExtension } from "../extensions/pi-minions/orchestrator.mjs";

const plainTheme = {
  fg(_color, text) { return text; },
  bold(text) { return text; },
};

function renderWidget(content, width = 120) {
  if (typeof content !== "function") return content;
  return content({ requestRender() {} }, plainTheme).render(width);
}

function createHarness({ provider = "openai-codex", modelId = "gpt-5.4", dependencies = {}, missingModels = [], modelCatalogs, frontierBusy = false, sessionEntries = [], setModelResults = [] } = {}) {
  const tools = new Map();
  const handlers = new Map();
  const modelChanges = [];
  const thinkingChanges = [];
  const sentMessages = [];
  const deliveredMessages = [];
  const widgets = [];
  const notifications = [];
  const appendedEntries = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { handlers.set(name, handler); },
    async setModel(model) { modelChanges.push(model); return setModelResults.length > 0 ? setModelResults.shift() : true; },
    setThinkingLevel(level) { thinkingChanges.push(level); },
    getThinkingLevel() { return "high"; },
    sendMessage(message, options) {
      sentMessages.push({ message, options });
      if (!frontierBusy || options?.deliverAs === "steer") deliveredMessages.push({ message, options });
    },
    appendEntry(customType, data) { appendedEntries.push({ type: "custom", customType, data }); },
  };
  const defaultCatalog = provider === "github-copilot"
    ? ["gpt-5.6-sol", "gpt-5.6-terra", "grok-4.5"]
    : ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
  const catalogs = modelCatalogs ?? { [provider]: defaultCatalog };
  const models = Object.entries(catalogs).flatMap(([catalogProvider, ids]) => ids
    .filter((id) => catalogProvider !== provider || !missingModels.includes(id))
    .map((id) => ({ provider: catalogProvider, id })));
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
      setStatus() {},
      setWidget(key, content, options) {
        widgets.push({ key, content, lines: content ? renderWidget(content) : content, options });
      },
    },
    sessionManager: {
      getSessionId() { return "parent-session"; },
      getEntries() { return sessionEntries; },
      getBranch() { return sessionEntries; },
    },
  };
  createPiMinionsExtension(pi, { schemas: {}, ...dependencies });
  return { pi, tools, handlers, ctx, modelChanges, thinkingChanges, sentMessages, deliveredMessages, widgets, notifications, appendedEntries };
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

test("required-model preflight uses the selected provider catalog without fallback", async () => {
  const cases = [
    { provider: "openai-codex", missing: "gpt-5.6-luna" },
    { provider: "github-copilot", missing: "grok-4.5" },
  ];

  for (const { provider, missing } of cases) {
    const otherProvider = provider === "openai-codex" ? "github-copilot" : "openai-codex";
    const harness = createHarness({
      provider,
      modelCatalogs: {
        [provider]: ["gpt-5.6-sol", "gpt-5.6-terra"],
        [otherProvider]: ["gpt-5.6-sol", "gpt-5.6-terra", missing],
      },
    });

    await assert.rejects(
      execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx),
      new RegExp(`Provider ${provider} is missing required model\\(s\\): ${missing.replace(".", "\\.")}`),
    );
    assert.equal(harness.modelChanges.length, 0);
  }
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

test("Copilot standard and low-budget routes replace Luna with Grok high only", async () => {
  const cases = [
    { variant: "standard", role: "mechanical", model: "grok-4.5", thinking: "high" },
    { variant: "standard", role: "architect", model: "gpt-5.6-sol", thinking: "medium" },
    { variant: "standard", role: "planner", model: "gpt-5.6-terra", thinking: "high" },
    { variant: "lb", role: "architect", model: "grok-4.5", thinking: "high" },
    { variant: "lb", role: "reviewer", model: "gpt-5.6-sol", thinking: "low" },
  ];

  for (const { variant, role, model, thinking } of cases) {
    const spawns = [];
    const harness = createHarness({ provider: "github-copilot", dependencies: {
      spawnProcess(command, args, options) { spawns.push({ command, args, options }); return fakeRpcProcess(); },
      piInvocation: { command: "pi", args: [] },
    } });
    await execute(harness.tools.get("minions_start"), { variant }, harness.ctx);
    await execute(harness.tools.get("minions_spawn"), {
      tasks: [{ role, task: `Run ${role}` }],
    }, harness.ctx);

    assert.ok(spawns[0].args.includes(`github-copilot/${model}`));
    assert.equal(spawns[0].args[spawns[0].args.indexOf("--thinking") + 1], thinking);
    assert.ok(!spawns[0].args.some((arg) => arg.includes("gpt-5.6-luna")));
  }
});

test("spawn tells the frontier to end its turn and wait for completion notifications", async () => {
  const harness = createHarness({ dependencies: {
    spawnProcess() { return fakeRpcProcess(); },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);

  const result = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);

  assert.match(result.content[0].text, /end this turn/i);
  assert.match(result.content[0].text, /do not poll/i);
});

test("mechanical judgment uses the profile-specific route", async () => {
  const cases = [
    { variant: "standard", model: "gpt-5.6-sol", thinking: "low" },
    { variant: "lb", model: "gpt-5.6-luna", thinking: "xhigh" },
  ];

  for (const { variant, model, thinking } of cases) {
    const spawns = [];
    const harness = createHarness({ dependencies: {
      spawnProcess(command, args, options) { spawns.push({ command, args, options }); return fakeRpcProcess(); },
      piInvocation: { command: "pi", args: [] },
    } });
    await execute(harness.tools.get("minions_start"), { variant }, harness.ctx);

    await execute(harness.tools.get("minions_spawn"), { tasks: [{
      role: "mechanical",
      routeOverride: "mechanical-judgment",
      task: "Resolve the merge conflict",
    }] }, harness.ctx);

    assert.ok(spawns[0].args.includes(`openai-codex/${model}`));
    assert.equal(spawns[0].args[spawns[0].args.indexOf("--thinking") + 1], thinking);
  }
});

test("escalation routes follow the standard and low-budget ladders", async () => {
  const validCases = [
    { variant: "standard", routeOverride: "escalate-entry", model: "gpt-5.6-sol", thinking: "medium" },
    { variant: "standard", routeOverride: "escalate-sol-high", model: "gpt-5.6-sol", thinking: "high" },
    { variant: "standard", routeOverride: "escalate-sol-max", model: "gpt-5.6-sol", thinking: "max" },
    { variant: "lb", routeOverride: "escalate-entry", model: "gpt-5.6-luna", thinking: "xhigh" },
    { variant: "lb", routeOverride: "escalate-sol-low", model: "gpt-5.6-sol", thinking: "low" },
    { variant: "lb", routeOverride: "escalate-sol-medium", model: "gpt-5.6-sol", thinking: "medium" },
  ];

  for (const { variant, routeOverride, model, thinking } of validCases) {
    const spawns = [];
    const harness = createHarness({ dependencies: {
      spawnProcess(command, args, options) { spawns.push({ command, args, options }); return fakeRpcProcess(); },
      piInvocation: { command: "pi", args: [] },
    } });
    await execute(harness.tools.get("minions_start"), { variant }, harness.ctx);
    await execute(harness.tools.get("minions_spawn"), {
      tasks: [{ role: "implementer", routeOverride, task: "Retry the failed work" }],
    }, harness.ctx);

    assert.ok(spawns[0].args.includes(`openai-codex/${model}`));
    assert.equal(spawns[0].args[spawns[0].args.indexOf("--thinking") + 1], thinking);
  }

  for (const routeOverride of ["escalate-sol-high", "escalate-sol-max"]) {
    const harness = createHarness();
    await execute(harness.tools.get("minions_start"), { variant: "lb" }, harness.ctx);
    await assert.rejects(
      execute(harness.tools.get("minions_spawn"), {
        tasks: [{ role: "implementer", routeOverride, task: "Retry the failed work" }],
      }, harness.ctx),
      new RegExp(`${routeOverride} is not available for lb`),
    );
  }
});

test("Copilot low-budget Luna overrides become Grok high while named Sol escalations stay unchanged", async () => {
  const cases = [
    { routeOverride: "mechanical-judgment", role: "mechanical", model: "grok-4.5", thinking: "high" },
    { routeOverride: "escalate-entry", role: "implementer", model: "grok-4.5", thinking: "high" },
    { routeOverride: "escalate-sol-low", role: "implementer", model: "gpt-5.6-sol", thinking: "low" },
    { routeOverride: "escalate-sol-medium", role: "implementer", model: "gpt-5.6-sol", thinking: "medium" },
  ];

  for (const { routeOverride, role, model, thinking } of cases) {
    const spawns = [];
    const harness = createHarness({ provider: "github-copilot", dependencies: {
      spawnProcess(command, args, options) { spawns.push({ command, args, options }); return fakeRpcProcess(); },
      piInvocation: { command: "pi", args: [] },
    } });
    await execute(harness.tools.get("minions_start"), { variant: "lb" }, harness.ctx);
    await execute(harness.tools.get("minions_spawn"), {
      tasks: [{ role, routeOverride, task: "Retry" }],
    }, harness.ctx);

    assert.ok(spawns[0].args.includes(`github-copilot/${model}`));
    assert.equal(spawns[0].args[spawns[0].args.indexOf("--thinking") + 1], thinking);
  }
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

test("close credits all worker usage not yet returned by read", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);
  const usage = {
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 4,
    totalTokens: 154,
    cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0.001, total: 0.034 },
  };
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    stopReason: "stop",
    usage,
  } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);

  const closed = await execute(harness.tools.get("minions_close"), {}, harness.ctx);

  assert.deepEqual(closed.usage, usage);
});

test("close restores the original Copilot model and thinking level", async () => {
  const harness = createHarness({ provider: "github-copilot", modelId: "gpt-4.1" });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);

  await execute(harness.tools.get("minions_close"), {}, harness.ctx);

  assert.deepEqual(harness.modelChanges.at(-1), { provider: "github-copilot", id: "gpt-4.1" });
  assert.equal(harness.thinkingChanges.at(-1), "high");
});

test("a failed model restore keeps the run active in persisted state", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ setModelResults: [true, false], dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);
  await execute(harness.tools.get("minions_stop"), { workerIds: [spawned.details.workers[0].id] }, harness.ctx);

  await assert.rejects(execute(harness.tools.get("minions_close"), {}, harness.ctx), /Unable to restore/);

  const states = harness.appendedEntries.filter((entry) => entry.customType === "pi-minions-state");
  assert.equal(states.at(-1).data.lifecycle, "active");
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

test("a settled worker notifies a busy frontier without waiting for it to become idle", async () => {
  const child = fakeRpcProcess();
  const scheduled = [];
  const harness = createHarness({ frontierBusy: true, dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);

  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  scheduled[0]();

  assert.equal(harness.deliveredMessages.length, 1);
  assert.equal(harness.deliveredMessages[0].message.customType, "pi-minions-completion");
});

test("read exposes the current RPC tool and its latest progress before the worker settles", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "mechanical", task: "Run verification" }],
  }, harness.ctx);
  const workerId = spawned.details.workers[0].id;

  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Starting verification" }], stopReason: "toolUse" } })}\n${JSON.stringify({ type: "tool_execution_start", toolName: "bash" })}\n${JSON.stringify({ type: "tool_execution_update", toolName: "bash", partialResult: { content: [{ type: "text", text: "tests: 4 passed" }] } })}\n`);
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [workerId] }, harness.ctx);

  assert.match(read.content[0].text, /bash/);
  assert.match(read.content[0].text, /tests: 4 passed/);
  assert.equal(read.details.workers[0].currentTool, "bash");
});

test("read accounts worker token usage and cost exactly once in the parent session", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "mechanical", task: "Run verification" }],
  }, harness.ctx);
  const workerId = spawned.details.workers[0].id;
  const firstUsage = { input: 100, output: 20, cacheRead: 30, cacheWrite: 4, reasoning: 5, totalTokens: 154, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
  const secondUsage = { input: 50, output: 10, cacheRead: 5, cacheWrite: 2, reasoning: 3, totalTokens: 67, cost: { input: 0.5, output: 1, cacheRead: 0.5, cacheWrite: 2, total: 4 } };

  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Checking" }], stopReason: "toolUse", usage: firstUsage } })}\n${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", usage: secondUsage } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  const firstRead = await execute(harness.tools.get("minions_read"), { workerIds: [workerId] }, harness.ctx);
  const secondRead = await execute(harness.tools.get("minions_read"), { workerIds: [workerId] }, harness.ctx);

  assert.deepEqual(firstRead.usage, {
    input: 150,
    output: 30,
    cacheRead: 35,
    cacheWrite: 6,
    reasoning: 8,
    totalTokens: 221,
    cost: { input: 1.5, output: 3, cacheRead: 3.5, cacheWrite: 6, total: 14 },
  });
  assert.deepEqual(firstRead.details.workers[0].usage, firstRead.usage);
  assert.equal(secondRead.usage, undefined);
  assert.deepEqual(secondRead.details.workers[0].usage, firstRead.usage);
});

test("the Pi widget renders one usage row per Active Worker without long activity text", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "lb" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "mechanical", task: "Task ID: T4\nRole: mechanical\nWorking directory: /repo\nQuestion: Run the final verification gate", routeOverride: "mechanical-judgment" }],
  }, harness.ctx);
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
    role: "assistant",
    content: [{ type: "text", text: "Starting verification" }],
    stopReason: "toolUse",
    usage: {
      input: 10_000,
      output: 2_000,
      cacheRead: 300,
      cacheWrite: 40,
      totalTokens: 12_340,
      cost: { input: 0.02, output: 0.02, cacheRead: 0.006, cacheWrite: 0.001, total: 0.047 },
    },
  } })}\n${JSON.stringify({ type: "tool_execution_start", toolName: "bash" })}\n`);

  const visible = harness.widgets.at(-1);
  const board = visible.lines.join("\n");
  assert.equal(visible.key, "pi-minions-workers");
  assert.equal(typeof visible.content, "function");
  assert.equal(visible.lines.length, 2);
  assert.match(board, /MINIONS LB 1\/6/);
  assert.match(board, /SESSION 12\.3k.*\$0\.047/);
  assert.match(board, /W1/);
  assert.match(board, /mechanical/);
  assert.match(board, /luna:xhigh/);
  assert.match(board, /12\.3k/);
  assert.match(board, /\$0\.047/);
  assert.doesNotMatch(board, /T4|Run the final verification gate|bash|override|[0-9a-f]{8}/);
});

test("the Pi widget preserves a non-zero reported cost instead of rounding it to zero", async () => {
  const child = fakeRpcProcess();
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
    role: "assistant",
    content: [{ type: "text", text: "Working" }],
    stopReason: "toolUse",
    usage: {
      input: 1,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1,
      cost: { input: 0.00004, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00004 },
    },
  } })}\n`);

  const board = harness.widgets.at(-1).lines.join("\n");
  assert.match(board, /\$0\.00004/);
  assert.doesNotMatch(board, /\$0\.0000(?:\D|$)/);
});

test("the Pi widget refreshes elapsed time once per second only while workers are active", async () => {
  const child = fakeRpcProcess();
  const widgetSchedules = [];
  const cancelled = [];
  let timestamp = 1_000;
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
    now() { return timestamp; },
    setWidgetTimeout(callback, delay) {
      const id = widgetSchedules.length + 1;
      widgetSchedules.push({ id, callback, delay });
      return id;
    },
    clearWidgetTimeout(id) { cancelled.push(id); },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);

  assert.equal(widgetSchedules[0].delay, 1_000);
  timestamp = 4_000;
  widgetSchedules[0].callback();
  assert.match(harness.widgets.at(-1).lines.join("\n"), /3s/);

  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.ok(cancelled.includes(widgetSchedules[1].id));
});

test("the Pi widget Session Usage combines parent usage with uncredited worker usage", async () => {
  const child = fakeRpcProcess();
  const parentUsage = {
    input: 700,
    output: 200,
    cacheRead: 100,
    cacheWrite: 0,
    totalTokens: 1_000,
    cost: { input: 0.05, output: 0.04, cacheRead: 0.01, cacheWrite: 0, total: 0.10 },
  };
  const harness = createHarness({
    sessionEntries: [{ type: "message", message: { role: "assistant", usage: parentUsage } }],
    dependencies: {
      spawnProcess() { return child; },
      piInvocation: { command: "pi", args: [] },
    },
  });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
    role: "assistant",
    content: [{ type: "text", text: "Working" }],
    stopReason: "toolUse",
    usage: {
      input: 300,
      output: 100,
      cacheRead: 100,
      cacheWrite: 0,
      totalTokens: 500,
      cost: { input: 0.02, output: 0.02, cacheRead: 0.01, cacheWrite: 0, total: 0.05 },
    },
  } })}\n`);

  const board = harness.widgets.at(-1).lines.join("\n");
  assert.match(board, /SESSION 1\.5k.*\$0\.15/);
});

test("the Pi widget Session Usage does not double count worker usage credited by read", async () => {
  const child = fakeRpcProcess();
  const parentUsage = {
    input: 700,
    output: 200,
    cacheRead: 100,
    cacheWrite: 0,
    totalTokens: 1_000,
    cost: { input: 0.05, output: 0.04, cacheRead: 0.01, cacheWrite: 0, total: 0.10 },
  };
  const sessionEntries = [{ type: "message", message: { role: "assistant", usage: parentUsage } }];
  const harness = createHarness({
    sessionEntries,
    dependencies: {
      spawnProcess() { return child; },
      piInvocation: { command: "pi", args: [] },
    },
  });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, harness.ctx);
  const workerId = spawned.details.workers[0].id;
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
    role: "assistant",
    content: [{ type: "text", text: "Working" }],
    stopReason: "toolUse",
    usage: {
      input: 300,
      output: 100,
      cacheRead: 100,
      cacheWrite: 0,
      totalTokens: 500,
      cost: { input: 0.02, output: 0.02, cacheRead: 0.01, cacheWrite: 0, total: 0.05 },
    },
  } })}\n`);

  const read = await execute(harness.tools.get("minions_read"), { workerIds: [workerId] }, harness.ctx);
  sessionEntries.push({ type: "message", message: { role: "toolResult", usage: read.usage } });
  const board = renderWidget(harness.widgets.at(-1).content).join("\n");

  assert.match(board, /SESSION 1\.5k.*\$0\.15/);
  assert.doesNotMatch(board, /SESSION 2k|\$0\.20/);
});

test("the Pi widget keeps six Active Workers readable within seven lines at compact width", async () => {
  const children = Array.from({ length: 6 }, () => fakeRpcProcess());
  const queue = [...children];
  const harness = createHarness({ dependencies: {
    spawnProcess() { return queue.shift(); },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), { tasks: [
    { role: "mechanical", task: "Mechanical" },
    { role: "explorer", task: "Explore" },
    { role: "implementer", task: "Implement" },
    { role: "architect", task: "Architect" },
    { role: "reviewer", task: "Review" },
    { role: "planner", task: "Plan" },
  ] }, harness.ctx);
  const usage = {
    input: 10_000,
    output: 2_000,
    cacheRead: 300,
    cacheWrite: 40,
    totalTokens: 12_340,
    cost: { input: 0.02, output: 0.02, cacheRead: 0.006, cacheWrite: 0.001, total: 0.047 },
  };
  for (const child of children) {
    child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: {
      role: "assistant",
      content: [{ type: "text", text: "Working" }],
      stopReason: "toolUse",
      usage,
    } })}\n`);
  }

  const lines = renderWidget(harness.widgets.at(-1).content, 24);
  assert.equal(lines.length, 7);
  assert.ok(lines.every((line) => line.length <= 24), lines.join("\n"));
  assert.match(lines[0], /M-STD 6\/6/);
  assert.match(lines.join("\n"), /W1 MEC LUN/);
  assert.match(lines.join("\n"), /W2 EXP LUN/);
  assert.match(lines.join("\n"), /W3 IMP LUN/);
  assert.match(lines.join("\n"), /W4 ARC SOL/);
  assert.match(lines.join("\n"), /W5 REV SOL/);
  assert.match(lines.join("\n"), /W6 PLN TER/);
  assert.match(lines.join("\n"), /12k \$\.047/);
});

test("the Pi widget keeps only Session Usage after completion while diagnostics freeze completion time", async () => {
  const child = fakeRpcProcess();
  let timestamp = 1_000;
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
    now() { return timestamp; },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Question: Inspect worker retention" }],
  }, harness.ctx);

  timestamp = 6_000;
  child.stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  const visible = harness.widgets.at(-1);
  timestamp = 100_000;
  const board = renderWidget(visible.content).join("\n");

  assert.equal(board, "MINIONS STD 0/6 │ SESSION 0 · $0.00");
  assert.doesNotMatch(board, /explorer|Inspect worker retention/);
  const snapshot = harness.appendedEntries.at(-1).data.workers[0];
  assert.equal(snapshot.completedAt, 6_000);
});

test("an explicit worker deadline blocks and aborts a worker that does not settle", async () => {
  const child = fakeRpcProcess();
  const scheduled = [];
  const harness = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
    setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout() {},
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  const spawned = await execute(harness.tools.get("minions_spawn"), {
    tasks: [{ role: "mechanical", task: "Run verification", timeoutSeconds: 30 }],
  }, harness.ctx);
  const workerId = spawned.details.workers[0].id;

  assert.equal(scheduled[0].delay, 30_000);
  scheduled[0].callback();
  const read = await execute(harness.tools.get("minions_read"), { workerIds: [workerId] }, harness.ctx);

  assert.equal(read.details.workers[0].status, "blocked");
  assert.match(read.details.workers[0].error, /30 seconds/);
  assert.deepEqual(JSON.parse(child.stdin.writes.at(-1)), { type: "abort" });
});

test("reload preserves interrupted diagnostics but removes the Active Worker widget", async () => {
  const child = fakeRpcProcess();
  const first = createHarness({ dependencies: {
    spawnProcess() { return child; },
    piInvocation: { command: "pi", args: [] },
  } });
  await execute(first.tools.get("minions_start"), { variant: "standard" }, first.ctx);
  await execute(first.tools.get("minions_spawn"), {
    tasks: [{ role: "explorer", task: "Explore" }],
  }, first.ctx);
  first.handlers.get("session_shutdown")({ reason: "reload" }, first.ctx);

  assert.equal(first.widgets.at(-1).content, undefined);
  const interruptedState = first.appendedEntries
    .filter((entry) => entry.customType === "pi-minions-state")
    .at(-1);
  assert.equal(interruptedState.data.lifecycle, "interrupted");

  const resumed = createHarness({ sessionEntries: first.appendedEntries });
  resumed.handlers.get("session_start")({ reason: "reload" }, resumed.ctx);

  assert.equal(resumed.widgets.length, 0);
  assert.match(resumed.notifications.at(-1).message, /stopped 1 active Pi minions worker/);
});

test("settled workers leave the Active Worker view and emit one short aggregated notification", async () => {
  const children = [fakeRpcProcess(), fakeRpcProcess()];
  const queue = [...children];
  const scheduled = [];
  const harness = createHarness({ dependencies: {
    spawnProcess() { return queue.shift(); },
    piInvocation: { command: "pi", args: [] },
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
  } });
  await execute(harness.tools.get("minions_start"), { variant: "standard" }, harness.ctx);
  await execute(harness.tools.get("minions_spawn"), { tasks: [
    { role: "explorer", task: "Explore A" },
    { role: "reviewer", task: "Review B" },
  ] }, harness.ctx);

  children[0].stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "A done" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  children[1].stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "B failed" }], stopReason: "error" } })}\n${JSON.stringify({ type: "agent_settled" })}\n`);
  scheduled[0]();

  assert.deepEqual(harness.widgets.at(-1).lines, ["MINIONS STD 0/6 │ SESSION 0 · $0.00"]);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "W1 completed · W2 blocked",
    level: "warning",
  });
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
