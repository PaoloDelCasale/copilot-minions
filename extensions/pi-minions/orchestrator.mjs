import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const SUPPORTED_PROVIDERS = new Set(["openai-codex", "github-copilot"]);
const REQUIRED_MODELS = {
  standard: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  lb: ["gpt-5.6-sol", "gpt-5.6-luna"],
};

const ROUTES = {
  standard: {
    mechanical: ["gpt-5.6-luna", "low"],
    explorer: ["gpt-5.6-luna", "high"],
    implementer: ["gpt-5.6-luna", "xhigh"],
    architect: ["gpt-5.6-sol", "medium"],
    reviewer: ["gpt-5.6-sol", "low"],
    planner: ["gpt-5.6-terra", "high"],
  },
  lb: {
    mechanical: ["gpt-5.6-luna", "low"],
    explorer: ["gpt-5.6-luna", "medium"],
    implementer: ["gpt-5.6-luna", "high"],
    architect: ["gpt-5.6-luna", "high"],
    reviewer: ["gpt-5.6-sol", "low"],
    planner: ["gpt-5.6-luna", "high"],
  },
};

const ROUTE_OVERRIDES = {
  "mechanical-judgment": {
    standard: ["gpt-5.6-terra", "medium"],
    lb: ["gpt-5.6-sol", "medium"],
  },
  "escalate-entry": {
    standard: ["gpt-5.6-luna", "xhigh"],
    lb: ["gpt-5.6-luna", "high"],
  },
  "escalate-terra-medium": {
    standard: ["gpt-5.6-terra", "medium"],
  },
  "escalate-sol-medium": {
    standard: ["gpt-5.6-sol", "medium"],
    lb: ["gpt-5.6-sol", "medium"],
  },
  "escalate-sol-high": {
    standard: ["gpt-5.6-sol", "high"],
    lb: ["gpt-5.6-sol", "high"],
  },
  "escalate-sol-max": {
    standard: ["gpt-5.6-sol", "max"],
    lb: ["gpt-5.6-sol", "max"],
  },
};

const ROLE_TOOLS = {
  mechanical: "read,bash,edit,write",
  explorer: "read,bash,grep,find,ls",
  implementer: "read,bash,edit,write,grep,find,ls",
  architect: "read,bash,edit,write,grep,find,ls",
  reviewer: "read,bash,grep,find,ls",
  planner: "read,grep,find,ls",
};

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

function truncateForContext(text, maxBytes = 50 * 1024) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end--;
  return `${text.slice(0, end)}\n\n[Output truncated for parent context; full output remains in worker details.]`;
}

function defaultPiInvocation() {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript] };
  }
  const executable = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, args: [] };
  return { command: "pi", args: [] };
}

function attachJsonlReader(stream, onRecord) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const drain = () => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line) onRecord(line);
    }
  };
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    drain();
  });
  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer) onRecord(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  });
}

export function createPiMinionsExtension(pi, dependencies = {}) {
  const schemas = dependencies.schemas ?? {};
  const spawnProcess = dependencies.spawnProcess ?? nodeSpawn;
  const piInvocation = dependencies.piInvocation ?? defaultPiInvocation();
  const schedule = dependencies.setTimeout ?? setTimeout;
  const cancelSchedule = dependencies.clearTimeout ?? clearTimeout;
  const now = dependencies.now ?? Date.now;
  let run;
  let changingModel = false;
  let completionTimer;
  const pendingCompletions = new Set();

  function workerSnapshot(worker, status = worker.status) {
    return {
      id: worker.id,
      role: worker.role,
      cwd: worker.cwd,
      provider: worker.provider,
      model: worker.model,
      thinking: worker.thinking,
      status,
      startedAt: worker.startedAt,
      timeoutSeconds: worker.timeoutSeconds,
      currentTool: worker.currentTool,
      error: worker.error,
    };
  }

  function persistRun(lifecycle = "active", workerStatus) {
    if (!run) return;
    pi.appendEntry("pi-minions-state", {
      runId: run.id,
      provider: run.provider,
      variant: run.variant,
      lifecycle,
      workers: [...run.workers.values()].map((worker) => workerSnapshot(worker, workerStatus ?? worker.status)),
    });
  }

  function renderWorkerWidget(ctx, snapshot) {
    if (!ctx.ui?.setWidget) return;
    if (!snapshot) {
      ctx.ui.setWidget("pi-minions-workers", undefined);
      return;
    }
    const workers = snapshot.workers ?? [];
    const lines = [`Minions · ${snapshot.provider} · ${snapshot.variant}`];
    if (workers.length === 0) lines.push("  no workers");
    for (const worker of workers) {
      const elapsedSeconds = Math.max(0, Math.floor((now() - worker.startedAt) / 1000));
      const activity = worker.currentTool ? ` · ${worker.currentTool}` : "";
      lines.push(`  ${worker.id.slice(0, 8)} · ${worker.role} · ${worker.status} · ${worker.model}:${worker.thinking} · ${elapsedSeconds}s${activity}`);
    }
    ctx.ui.setWidget("pi-minions-workers", lines, { placement: "aboveEditor" });
  }

  function updateWorkerWidget(ctx) {
    if (!run) return renderWorkerWidget(ctx, undefined);
    renderWorkerWidget(ctx, {
      provider: run.provider,
      variant: run.variant,
      workers: [...run.workers.values()].map((worker) => workerSnapshot(worker)),
    });
  }

  function notifyCompletion(worker) {
    pendingCompletions.add(worker.id);
    if (completionTimer) return;
    completionTimer = schedule(() => {
      completionTimer = undefined;
      const ids = [...pendingCompletions];
      pendingCompletions.clear();
      if (!run || ids.length === 0) return;
      pi.sendMessage({
        customType: "pi-minions-completion",
        content: `Worker completion notification: ${ids.join(", ")}. Read each worker, update the board, and dispatch newly unblocked work.`,
        display: true,
        details: { runId: run.id, workerIds: ids },
      }, { deliverAs: "steer", triggerTurn: true });
    }, 50);
  }

  function startWorker(spec, ctx) {
    const roleRoute = ROUTES[run.variant][spec.role];
    if (!roleRoute) throw new Error(`Unknown worker role: ${spec.role}`);
    const route = spec.routeOverride ? ROUTE_OVERRIDES[spec.routeOverride]?.[run.variant] : roleRoute;
    if (!route) throw new Error(`Route override ${spec.routeOverride} is not available for ${run.variant}.`);
    const [defaultModel, thinking] = route;
    const modelId = spec.modelOverride ?? defaultModel;
    if (!ctx.modelRegistry.find(run.provider, modelId)) {
      throw new Error(`Provider ${run.provider} does not offer requested model ${modelId}.`);
    }
    const id = randomUUID();
    const args = [
      ...piInvocation.args,
      "--mode", "rpc",
      "--no-session",
      "--no-extensions",
      "--approve",
      "--model", `${run.provider}/${modelId}`,
      "--thinking", thinking,
      "--tools", ROLE_TOOLS[spec.role],
    ];
    const child = spawnProcess(piInvocation.command, args, {
      cwd: spec.cwd ?? ctx.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const worker = {
      id,
      role: spec.role,
      task: spec.task,
      cwd: spec.cwd ?? ctx.cwd,
      provider: run.provider,
      model: modelId,
      thinking,
      status: "in-flight",
      output: "",
      stderr: "",
      process: child,
      finalized: false,
      startedAt: now(),
      timeoutSeconds: spec.timeoutSeconds,
    };
    run.workers.set(id, worker);
    updateWorkerWidget(ctx);

    const finalize = (status, error) => {
      if (worker.finalized) return;
      worker.finalized = true;
      if (worker.timeoutTimer) cancelSchedule(worker.timeoutTimer);
      worker.status = status;
      if (error) worker.error = error;
      persistRun();
      updateWorkerWidget(ctx);
      if (status !== "stopped") notifyCompletion(worker);
    };
    if (spec.timeoutSeconds) {
      worker.timeoutTimer = schedule(() => {
        if (worker.finalized) return;
        try { child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`); } catch {}
        finalize("blocked", `Worker exceeded its ${spec.timeoutSeconds} seconds deadline.`);
        const killTimer = schedule(() => child.kill?.("SIGTERM"), 2000);
        killTimer?.unref?.();
      }, spec.timeoutSeconds * 1000);
      worker.timeoutTimer?.unref?.();
    }
    attachJsonlReader(child.stdout, (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = event.message.content?.find?.((part) => part.type === "text")?.text;
        if (text) worker.output = text;
        worker.usage = event.message.usage;
        worker.stopReason = event.message.stopReason;
      }
      if (event.type === "tool_execution_start") {
        worker.currentTool = event.toolName;
        worker.progress = "";
        updateWorkerWidget(ctx);
      }
      if (event.type === "tool_execution_update") {
        worker.currentTool = event.toolName ?? worker.currentTool;
        const text = event.partialResult?.content?.find?.((part) => part.type === "text")?.text;
        if (text) worker.progress = text;
        updateWorkerWidget(ctx);
      }
      if (event.type === "tool_execution_end") {
        const text = event.result?.content?.find?.((part) => part.type === "text")?.text;
        if (text) worker.progress = text;
        worker.currentTool = undefined;
        updateWorkerWidget(ctx);
      }
      if (event.type === "response" && event.command === "prompt" && event.success === false) {
        finalize("blocked", event.error || "Worker prompt was rejected.");
        child.kill?.("SIGTERM");
      }
      if (event.type === "agent_settled") {
        const failed = worker.stopReason === "error" || worker.stopReason === "aborted";
        finalize(failed ? "blocked" : "done", failed ? `Worker stopped with reason ${worker.stopReason}.` : undefined);
        child.kill?.("SIGTERM");
      }
    });
    child.stderr?.on?.("data", (chunk) => { worker.stderr += chunk.toString(); });
    child.once?.("error", (error) => finalize("blocked", error.message));
    child.once?.("close", (code) => {
      if (!worker.finalized) finalize(code === 0 ? "done" : "blocked", code === 0 ? undefined : `RPC process exited with code ${code}.`);
      worker.exitCode = code;
    });
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: spec.task })}\n`);
    return worker;
  }

  pi.registerTool({
    name: "minions_start",
    label: "Start Minions",
    description: "Start one provider-affine Pi orchestration run.",
    parameters: schemas.start ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const variant = params.variant ?? "standard";
      if (!(variant in ROUTES)) throw new Error(`Unknown minions variant: ${variant}`);
      if (!ctx.isProjectTrusted()) throw new Error("Pi minions requires a trusted project.");
      const provider = ctx.model?.provider;
      if (!SUPPORTED_PROVIDERS.has(provider)) {
        throw new Error(`Unsupported provider: ${provider ?? "none"}. Select openai-codex or github-copilot.`);
      }
      if (run) {
        if (run.provider !== provider || run.variant !== variant) {
          throw new Error(`An orchestration run is already active with ${run.provider}/${run.variant}.`);
        }
        return textResult(`Orchestration already active with Provider Affinity ${provider} (${variant}).`, {
          runId: run.id,
          provider: run.provider,
          variant: run.variant,
        });
      }
      const missing = REQUIRED_MODELS[variant].filter((id) => !ctx.modelRegistry.find(provider, id));
      if (missing.length > 0) throw new Error(`Provider ${provider} is missing required model(s): ${missing.join(", ")}`);

      const frontier = ctx.modelRegistry.find(provider, "gpt-5.6-sol");
      const originalModel = ctx.model;
      const originalThinking = pi.getThinkingLevel();
      if (!(await pi.setModel(frontier))) throw new Error(`Unable to select ${provider}/gpt-5.6-sol.`);
      pi.setThinkingLevel("medium");
      run = {
        id: randomUUID(),
        provider,
        variant,
        originalModel,
        originalThinking,
        workers: new Map(),
      };
      ctx.ui?.setStatus?.("pi-minions", `${provider} · ${variant}`);
      persistRun();
      updateWorkerWidget(ctx);
      return textResult(`Started ${variant} orchestration with Provider Affinity ${provider}.`, {
        runId: run.id,
        provider,
        variant,
        frontier: "gpt-5.6-sol",
        thinking: "medium",
      });
    },
  });

  pi.registerTool({
    name: "minions_spawn",
    label: "Spawn Minions",
    description: "Spawn up to six background Pi RPC workers using role routing.",
    parameters: schemas.spawn ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!run) throw new Error("Start an orchestration run before spawning workers.");
      const tasks = params.tasks ?? [];
      if (tasks.length === 0) throw new Error("At least one worker task is required.");
      const inFlight = [...run.workers.values()].filter((worker) => worker.status === "in-flight").length;
      if (inFlight + tasks.length > 6) throw new Error("Pi minions allows at most six in-flight workers.");
      const workers = tasks.map((task) => startWorker(task, ctx));
      persistRun();
      return textResult(`Spawned ${workers.length} background worker(s): ${workers.map((worker) => `${worker.role} ${worker.id}`).join(", ")}. End this turn now; do not poll. Wait for completion notifications before calling minions_read.`, {
        workers: workers.map(({ id, role, cwd, provider, model, thinking, status }) => ({ id, role, cwd, provider, model, thinking, status })),
      });
    },
  });

  pi.registerTool({
    name: "minions_read",
    label: "Read Minions",
    description: "Read status and final output from managed Pi workers.",
    parameters: schemas.read ?? {},
    async execute(_id, params) {
      if (!run) throw new Error("No orchestration run is active.");
      const ids = params.workerIds?.length ? params.workerIds : [...run.workers.keys()];
      const workers = ids.map((id) => {
        const worker = run.workers.get(id);
        if (!worker) throw new Error(`Unknown worker: ${id}`);
        const { role, task, cwd, provider, model, thinking, timeoutSeconds, status, output, progress, currentTool, stderr, error, exitCode, usage, stopReason } = worker;
        return { id, role, task, cwd, provider, model, thinking, timeoutSeconds, status, output, progress, currentTool, stderr, error, exitCode, usage, stopReason };
      });
      const summaries = workers.map((worker) => {
        const activity = worker.currentTool ? `Running ${worker.currentTool}${worker.progress ? `\n${worker.progress}` : ""}` : worker.progress;
        const body = worker.error || (worker.currentTool ? activity : undefined) || worker.output || worker.stderr || activity || "(no output yet)";
        return `### ${worker.id} · ${worker.role} · ${worker.status}\n${body}`;
      });
      return textResult(truncateForContext(summaries.join("\n\n")), { workers });
    },
  });

  pi.registerTool({
    name: "minions_steer",
    label: "Steer Minion",
    description: "Send a steering message to an in-flight Pi worker.",
    parameters: schemas.steer ?? {},
    async execute(_id, params) {
      if (!run) throw new Error("No orchestration run is active.");
      const worker = run.workers.get(params.workerId);
      if (!worker) throw new Error(`Unknown worker: ${params.workerId}`);
      if (worker.status !== "in-flight") throw new Error(`Worker ${params.workerId} is not in flight.`);
      worker.process.stdin.write(`${JSON.stringify({ type: "steer", message: params.message })}\n`);
      return textResult(`Steering queued for worker ${worker.id}.`, { workerId: worker.id });
    },
  });

  pi.registerTool({
    name: "minions_stop",
    label: "Stop Minions",
    description: "Abort and stop one or more managed Pi workers.",
    parameters: schemas.stop ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!run) throw new Error("No orchestration run is active.");
      const ids = params.workerIds?.length ? params.workerIds : [...run.workers.values()].filter((worker) => worker.status === "in-flight").map((worker) => worker.id);
      for (const id of ids) {
        const worker = run.workers.get(id);
        if (!worker) throw new Error(`Unknown worker: ${id}`);
        if (worker.status !== "in-flight") continue;
        worker.status = "stopped";
        worker.finalized = true;
        updateWorkerWidget(ctx);
        worker.process.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
        const killTimer = schedule(() => worker.process.kill?.("SIGTERM"), 2000);
        killTimer?.unref?.();
      }
      persistRun();
      return textResult(`Stopped ${ids.length} worker(s).`, { workerIds: ids });
    },
  });

  pi.registerTool({
    name: "minions_close",
    label: "Close Minions",
    description: "Close the orchestration run and restore the parent's original model.",
    parameters: schemas.close ?? {},
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!run) return textResult("No orchestration run is active.");
      const active = [...run.workers.values()].filter((worker) => worker.status === "in-flight");
      if (active.length > 0) throw new Error(`Cannot close with ${active.length} in-flight worker(s).`);
      const closing = run;
      persistRun("closed");
      run = undefined;
      if (closing.originalModel) {
        changingModel = true;
        try {
          if (!(await pi.setModel(closing.originalModel))) {
            throw new Error(`Unable to restore ${closing.originalModel.provider}/${closing.originalModel.id}.`);
          }
          pi.setThinkingLevel(closing.originalThinking);
        } catch (error) {
          run = closing;
          persistRun();
          throw error;
        } finally {
          changingModel = false;
        }
      }
      ctx.ui?.setStatus?.("pi-minions", undefined);
      updateWorkerWidget(ctx);
      return textResult(`Closed orchestration ${closing.id} and restored the original model.`, { runId: closing.id });
    },
  });

  const hasInFlightWorkers = () => run && [...run.workers.values()].some((worker) => worker.status === "in-flight");

  pi.on("input", (event) => {
    if (event.source === "extension") return { action: "continue" };
    if (event.text.startsWith("/skill:codex-minions-lb")) {
      return { action: "transform", text: event.text.replace("/skill:codex-minions-lb", "/skill:pi-minions-lb") };
    }
    if (event.text.startsWith("/skill:codex-minions")) {
      return { action: "transform", text: event.text.replace("/skill:codex-minions", "/skill:pi-minions") };
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nPi harness routing: use pi-minions or pi-minions-lb for orchestration. Never use the Codex minions adapter inside Pi. After minions_spawn, end the turn immediately and do not poll minions_read; wait for a pi-minions-completion notification.`,
  }));

  pi.on("model_select", async (event, ctx) => {
    if (!run || changingModel) return;
    if (event.model.provider === run.provider && event.model.id === "gpt-5.6-sol") return;
    const frontier = ctx.modelRegistry.find(run.provider, "gpt-5.6-sol");
    changingModel = true;
    try {
      await pi.setModel(frontier);
      pi.setThinkingLevel("medium");
    } finally {
      changingModel = false;
    }
    ctx.ui?.notify?.(`Model locked to ${run.provider}/gpt-5.6-sol:medium while Pi minions is active.`, "warning");
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (!run || changingModel || event.level === "medium") return;
    pi.setThinkingLevel("medium");
    ctx.ui?.notify?.("Thinking level locked to medium while Pi minions is active.", "warning");
  });

  pi.on("session_start", (_event, ctx) => {
    let interrupted;
    let lastState;
    for (const entry of ctx.sessionManager.getEntries?.() ?? []) {
      if (entry.type !== "custom") continue;
      if (entry.customType === "pi-minions-state") lastState = entry.data;
      if (entry.customType === "pi-minions-reload-interrupted") interrupted = entry.data;
      if (entry.customType === "pi-minions-reload-notified") interrupted = undefined;
    }
    if (lastState?.lifecycle === "interrupted") renderWorkerWidget(ctx, lastState);
    if (!interrupted) return;
    ctx.ui?.notify?.(`Reload stopped ${interrupted.workerCount} active Pi minions worker(s).`, "warning");
    pi.appendEntry("pi-minions-reload-notified", { interruptedAt: interrupted.timestamp });
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    if (!hasInFlightWorkers()) return;
    ctx.ui?.notify?.("Stop active Pi minions workers before changing sessions.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    if (!hasInFlightWorkers()) return;
    ctx.ui?.notify?.("Stop active Pi minions workers before forking the session.", "warning");
    return { cancel: true };
  });

  pi.on("session_shutdown", (event) => {
    if (!run) return;
    const activeWorkers = [...run.workers.values()].filter((worker) => worker.status === "in-flight");
    if (event.reason === "reload" && activeWorkers.length > 0) {
      pi.appendEntry("pi-minions-reload-interrupted", {
        runId: run.id,
        workerCount: activeWorkers.length,
        timestamp: Date.now(),
      });
    }
    for (const worker of activeWorkers) {
      worker.status = "stopped";
      worker.finalized = true;
      try { worker.process.stdin.write(`${JSON.stringify({ type: "abort" })}\n`); } catch {}
      worker.process.kill?.("SIGTERM");
    }
    persistRun(event.reason === "reload" ? "interrupted" : "closed", event.reason === "reload" ? "interrupted" : undefined);
    run = undefined;
  });
}
