import assert from "node:assert/strict";
import test from "node:test";
import {
  createOrcaCliCaller,
  createOrcaRuntime,
  discoverOrcaHost,
} from "../extensions/pi-minions/orca-runtime.mjs";

const host = {
  command: "orca",
  terminalHandle: "term-parent",
  worktreeId: "repo-1::C:/repo",
  hookEndpoint: "C:/orca/endpoint.cmd",
  hookVersion: "1",
};

test("Orca discovery requires a complete live-agent identity and resolves the documented CLI", () => {
  const env = {
    ORCA_TERMINAL_HANDLE: "term-parent",
    ORCA_WORKTREE_ID: "repo-1::C:/repo",
    ORCA_AGENT_HOOK_ENDPOINT: "C:/orca/endpoint.cmd",
    ORCA_AGENT_HOOK_VERSION: "1",
  };
  assert.equal(discoverOrcaHost({ env, platform: "win32" }).command, "orca");
  assert.equal(discoverOrcaHost({ env, platform: "linux" }).command, "orca-ide");
  assert.equal(discoverOrcaHost({ env: { ...env, ORCA_CLI_COMMAND: "orca-dev" } }).command, "orca-dev");
  assert.equal(discoverOrcaHost({ env: { ...env, ORCA_AGENT_HOOK_VERSION: "2" } }), undefined);
  assert.equal(discoverOrcaHost({ env: { ORCA_TERMINAL_HANDLE: "term-parent" } }), undefined);
});

test("the Orca CLI caller parses authoritative JSON even for lifecycle non-zero exits", async () => {
  const invocations = [];
  const caller = createOrcaCliCaller(host, {
    execFileImpl(command, args, options, callback) {
      invocations.push({ command, args, options });
      callback(Object.assign(new Error("exit 1"), { code: 1 }), JSON.stringify({
        id: "request-1",
        ok: true,
        result: { state: "stop_unknown" },
      }), "");
    },
  });
  assert.deepEqual(await caller(["orchestration", "worker-stop", "--dispatch", "dispatch-1"]), {
    state: "stop_unknown",
  });
  assert.equal(invocations[0].command, "orca");
  assert.equal(invocations[0].args.at(-1), "--json");
});

test("the Orca runtime uses native Run, Task, terminal, and Dispatch lifecycle", async () => {
  const calls = [];
  let nextTask = 1;
  let nextDispatch = 1;
  const callOrca = async (args) => {
    calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "status") return {
      runtime: { state: "ready", capabilities: ["orchestration.contract.v1"] },
      graph: { state: "ready" },
    };
    if (command === "terminal show") return { terminal: { handle: "term-parent" } };
    if (command === "orchestration run-create") return { run: { id: "run-minions" } };
    if (command === "orchestration run-use") return { run: { id: args[args.indexOf("--id") + 1] } };
    if (command === "worktree show") return { worktree: { id: "repo-1::C:/repo" } };
    if (command === "orchestration task-create") return { task: { id: `task-${nextTask++}` } };
    if (command === "terminal create") return { terminal: { handle: "term-worker" } };
    if (command === "terminal wait") return { wait: { satisfied: true, status: "idle" } };
    if (command === "orchestration worker-show") return {
      dispatch: { id: args.at(-1), status: "completed", result: JSON.stringify({ body: "STATUS: DONE\nImplemented" }) },
      task: { status: "completed" },
      worker: { state: "completed", agent_terminal_handle: "term-worker" },
    };
    if (command === "orchestration worker-read") return {
      source: "terminal",
      terminal: { tail: ["fallback output"] },
    };
    if (command === "terminal send") return { send: { handle: "term-worker", bytesWritten: 12 } };
    if (command === "orchestration worker-start") return {
      state: "ready",
      dispatchId: `dispatch-${nextDispatch++}`,
      agentTerminalHandle: "term-worker",
    };
    if (command === "orchestration worker-stop") return { state: "stopped", processAction: "closed" };
    if (command === "orchestration worker-release") return { state: "released" };
    throw new Error(`Unexpected Orca command: ${args.join(" ")}`);
  };

  const runtime = createOrcaRuntime({
    host,
    callOrca,
    readRolePrompt: () => "Bounded role contract.",
  });
  const ping = await runtime.call("ping");
  assert.equal(ping.runtime, "orca");
  assert.equal(ping.runId, "run-minions");

  const spawned = await runtime.call("spawn", {
    agent: "pi-minions-implementer",
    task: "Implement the slice",
    cwd: "C:/repo",
    model: "github-copilot/gpt-5.6-terra:max",
  });
  assert.equal(spawned.details.runtimeAgentId, "dispatch-1");
  assert.equal(spawned.details.runtimeTerminalId, "term-worker");
  assert.equal(spawned.details.runtimeTaskId, "task-1");
  const terminalCreate = calls.find((args) => args.slice(0, 2).join(" ") === "terminal create");
  assert.equal(terminalCreate[terminalCreate.indexOf("--command") + 1], "pi --model github-copilot/gpt-5.6-terra --thinking max");
  const taskCreate = calls.find((args) => args.slice(0, 2).join(" ") === "orchestration task-create");
  const taskSpec = taskCreate[taskCreate.indexOf("--spec") + 1];
  const initialStart = calls.find((args) => args.slice(0, 2).join(" ") === "orchestration worker-start");
  assert.equal(initialStart[initialStart.indexOf("--task") + 1], "task-1");
  assert.equal(initialStart[initialStart.indexOf("--terminal") + 1], "term-worker");
  assert.equal(calls.some((args) => args.slice(0, 2).join(" ") === "orchestration dispatch"), false);
  assert.match(taskSpec, /Orca-managed Minions implementer/);
  assert.match(taskSpec, /worker_done exactly once/);
  assert.match(taskSpec, /do not call Orca ask/);
  assert.match(taskSpec, /Implement the slice/);

  const status = await runtime.call("status", {
    id: "dispatch-1",
    runId: spawned.details.asyncId,
  });
  assert.equal(status.details.completion.state, "complete");
  assert.match(status.details.completion.summary, /STATUS: DONE/);

  await runtime.call("steer", {
    id: "dispatch-1",
    terminalId: "term-worker",
    message: "Focus on auth",
  });
  const send = calls.find((args) => args.slice(0, 2).join(" ") === "terminal send");
  assert.ok(send.includes("--interrupt"));
  assert.match(send[send.indexOf("--text") + 1], /Focus on auth/);

  const resumed = await runtime.call("resume", {
    id: "dispatch-1",
    terminalId: "term-worker",
    agent: "pi-minions-implementer",
    task: "Implement the slice",
    message: "Address review feedback",
  });
  assert.equal(resumed.details.runtimeAgentId, "dispatch-2");
  assert.equal(resumed.details.runtimeTerminalId, "term-worker");
  assert.equal(resumed.details.runtimeTaskId, "task-2");

  assert.equal((await runtime.call("stop", { id: "dispatch-2" })).state, "stopping");
  assert.equal((await runtime.call("release", { id: "dispatch-2" })).state, "released");
});

test("Orca worker-start waits for delayed agent-hook registration", async () => {
  const calls = [];
  const delays = [];
  let starts = 0;
  const callOrca = async (args) => {
    calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "status") return {
      runtime: { state: "ready", capabilities: ["orchestration.contract.v1"] },
      graph: { state: "ready" },
    };
    if (command === "orchestration run-create") return { run: { id: "run-registration" } };
    if (command === "worktree show") return { worktree: { id: "repo::C:/repo" } };
    if (command === "orchestration task-create") return { task: { id: "task-registration" } };
    if (command === "terminal create") return { terminal: { handle: "term-registration" } };
    if (command === "terminal wait") return { wait: { satisfied: true } };
    if (command === "orchestration worker-start") {
      starts += 1;
      if (starts < 3) throw new Error("Orca CLI failed (agent_unconfigured): terminal hook pending");
      return { state: "ready", dispatchId: "dispatch-registration", agentTerminalHandle: "term-registration" };
    }
    throw new Error(`Unexpected Orca command: ${args.join(" ")}`);
  };
  const runtime = createOrcaRuntime({
    host,
    callOrca,
    readRolePrompt: () => "Role.",
    workerStartMaxAttempts: 3,
    workerStartRetryDelayMs: 25,
    delay: async (ms) => { delays.push(ms); },
  });
  await runtime.call("ping");
  const worker = await runtime.call("spawn", {
    agent: "pi-minions-mechanical",
    task: "Inspect",
    cwd: "C:/repo",
    model: "github-copilot/gpt-5.6-luna:high",
  });
  assert.equal(worker.details.runtimeAgentId, "dispatch-registration");
  assert.equal(starts, 3);
  assert.deepEqual(delays, [25, 25]);
});

test("legacy low-level Orca dispatches reconcile completion and release their exact terminal", async () => {
  const calls = [];
  const callOrca = async (args) => {
    calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "status") return {
      runtime: { state: "ready", capabilities: ["orchestration.contract.v1"] },
      graph: { state: "ready" },
    };
    if (command === "orchestration run-create") return { run: { id: "run-legacy" } };
    if (command === "orchestration worker-show") throw new Error("Orca CLI failed (dispatch_not_found): missing supervised worker");
    if (command === "orchestration dispatch-show") return {
      dispatch: { id: "ctx-legacy", task_id: "task-legacy", status: "completed" },
    };
    if (command === "orchestration task-list") return {
      tasks: [{
        id: "task-legacy",
        status: "completed",
        result: JSON.stringify({ body: "Legacy worker result" }),
      }],
    };
    if (command === "orchestration worker-read") throw new Error("Orca CLI failed (dispatch_not_found): no supervised output");
    if (command === "orchestration worker-release") throw new Error("Orca CLI failed (dispatch_not_found): no supervised worker");
    if (command === "terminal close") return { close: { handle: "term-legacy" } };
    throw new Error(`Unexpected Orca command: ${args.join(" ")}`);
  };
  const runtime = createOrcaRuntime({ host, callOrca, readRolePrompt: () => "Role." });
  await runtime.call("ping");
  const status = await runtime.call("status", {
    id: "ctx-legacy",
    taskId: "task-legacy",
    terminalId: "term-legacy",
    runId: "orca:ctx-legacy",
  });
  assert.equal(status.details.completion.state, "complete");
  assert.equal(status.details.completion.summary, "Legacy worker result");
  const release = await runtime.call("release", {
    id: "ctx-legacy",
    taskId: "task-legacy",
    terminalId: "term-legacy",
  });
  assert.equal(release.state, "released");
  assert.equal(release.processAction, "legacy-terminal-close");
  assert.equal(calls.some((args) => args.join(" ").includes("terminal close --terminal term-legacy")), true);
});

test("retained and inactive external Orca workers close without blocking Minions", async () => {
  const calls = [];
  let releaseMode = "retained";
  const callOrca = async (args) => {
    calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "status") return {
      runtime: { state: "ready", capabilities: ["orchestration.contract.v1"] },
      graph: { state: "ready" },
    };
    if (command === "orchestration run-create") return { run: { id: "run-release" } };
    if (command === "orchestration worker-release") {
      if (releaseMode === "retained") return { state: "retained", reason: "external_terminal" };
      throw new Error("Orca CLI failed (dispatch_inactive): stopped worker");
    }
    if (command === "orchestration worker-show") return {
      dispatch: { id: "dispatch-release", status: "failed" },
      task: { status: "failed" },
      worker: { state: "stopped" },
    };
    if (command === "terminal close") return { close: { handle: "term-release" } };
    throw new Error(`Unexpected Orca command: ${args.join(" ")}`);
  };
  const runtime = createOrcaRuntime({ host, callOrca, readRolePrompt: () => "Role." });
  await runtime.call("ping");
  const retained = await runtime.call("release", {
    id: "dispatch-release",
    taskId: "task-release",
    terminalId: "term-release",
  });
  assert.equal(retained.state, "released");
  assert.equal(retained.processAction, "external-terminal-close");

  releaseMode = "inactive";
  const inactive = await runtime.call("release", {
    id: "dispatch-release",
    taskId: "task-release",
    terminalId: "term-release",
  });
  assert.equal(inactive.state, "released");
  assert.equal(inactive.processAction, "inactive-terminal-close");
  assert.equal(calls.filter((args) => args.slice(0, 2).join(" ") === "terminal close").length, 2);
});

test("an uncertain Orca worker-start reply is reconciled before any terminal cleanup", async () => {
  const calls = [];
  const callOrca = async (args) => {
    calls.push(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "status") return {
      runtime: { state: "ready", capabilities: ["orchestration.contract.v1"] },
      graph: { state: "ready" },
    };
    if (command === "orchestration run-create") return { run: { id: "run-1" } };
    if (command === "worktree show") return { worktree: { id: "repo::C:/repo" } };
    if (command === "orchestration task-create") return { task: { id: "task-1" } };
    if (command === "terminal create") return { terminal: { handle: "term-1" } };
    if (command === "terminal wait") return { wait: { satisfied: true } };
    if (command === "orchestration worker-start") throw new Error("transport closed after mutation");
    if (command === "orchestration dispatch-show") return { dispatch: { id: "dispatch-recovered" } };
    if (command === "terminal close" || command === "orchestration task-update") {
      throw new Error(`unsafe cleanup attempted: ${command}`);
    }
    throw new Error(`Unexpected Orca command: ${args.join(" ")}`);
  };
  const runtime = createOrcaRuntime({ host, callOrca, readRolePrompt: () => "Role." });
  await runtime.call("ping");
  const worker = await runtime.call("spawn", {
    agent: "pi-minions-explorer",
    task: "Inspect",
    cwd: "C:/repo",
    model: "openai-codex/gpt-5.6-luna:high",
  });
  assert.equal(worker.details.runtimeAgentId, "dispatch-recovered");
  assert.match(worker.text, /Recovered Orca worker/);
  assert.equal(calls.some((args) => args.slice(0, 2).join(" ") === "terminal close"), false);
  assert.equal(calls.some((args) => args.slice(0, 2).join(" ") === "orchestration task-update"), false);
});
