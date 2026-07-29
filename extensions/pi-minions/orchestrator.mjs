import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const SUPPORTED_PROVIDERS = new Set(["openai-codex", "github-copilot"]);
const SUPPORTED_VARIANTS = new Set(["standard", "lb"]);
const PROVIDER_MATRICES = {
  "openai-codex": {
    standard: {
      requiredModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
      routes: {
        mechanical: ["gpt-5.6-luna", "low"],
        explorer: ["gpt-5.6-luna", "high"],
        implementer: ["gpt-5.6-luna", "xhigh"],
        architect: ["gpt-5.6-sol", "medium"],
        reviewer: ["gpt-5.6-sol", "low"],
        planner: ["gpt-5.6-terra", "high"],
      },
      overrides: {
        "mechanical-judgment": ["gpt-5.6-sol", "low"],
        "escalate-entry": ["gpt-5.6-sol", "medium"],
        "escalate-sol-medium": ["gpt-5.6-sol", "medium"],
        "escalate-sol-high": ["gpt-5.6-sol", "high"],
        "escalate-sol-max": ["gpt-5.6-sol", "max"],
      },
    },
    lb: {
      requiredModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
      routes: {
        mechanical: ["gpt-5.6-luna", "low"],
        explorer: ["gpt-5.6-luna", "medium"],
        implementer: ["gpt-5.6-luna", "high"],
        architect: ["gpt-5.6-luna", "high"],
        reviewer: ["gpt-5.6-sol", "low"],
        planner: ["gpt-5.6-luna", "high"],
      },
      overrides: {
        "mechanical-judgment": ["gpt-5.6-luna", "xhigh"],
        "escalate-entry": ["gpt-5.6-luna", "xhigh"],
        "escalate-sol-low": ["gpt-5.6-sol", "low"],
        "escalate-sol-medium": ["gpt-5.6-sol", "medium"],
      },
    },
  },
  "github-copilot": {
    standard: {
      requiredModels: ["gpt-5.6-sol", "gpt-5.6-terra", "grok-4.5"],
      routes: {
        mechanical: ["grok-4.5", "high"],
        explorer: ["grok-4.5", "high"],
        implementer: ["grok-4.5", "high"],
        architect: ["gpt-5.6-sol", "medium"],
        reviewer: ["gpt-5.6-sol", "low"],
        planner: ["gpt-5.6-terra", "high"],
      },
      overrides: {
        "mechanical-judgment": ["gpt-5.6-sol", "low"],
        "escalate-entry": ["gpt-5.6-sol", "medium"],
        "escalate-sol-medium": ["gpt-5.6-sol", "medium"],
        "escalate-sol-high": ["gpt-5.6-sol", "high"],
        "escalate-sol-max": ["gpt-5.6-sol", "max"],
      },
    },
    lb: {
      requiredModels: ["gpt-5.6-sol", "grok-4.5"],
      routes: {
        mechanical: ["grok-4.5", "high"],
        explorer: ["grok-4.5", "high"],
        implementer: ["grok-4.5", "high"],
        architect: ["grok-4.5", "high"],
        reviewer: ["gpt-5.6-sol", "low"],
        planner: ["grok-4.5", "high"],
      },
      overrides: {
        "mechanical-judgment": ["grok-4.5", "high"],
        "escalate-entry": ["grok-4.5", "high"],
        "escalate-sol-low": ["gpt-5.6-sol", "low"],
        "escalate-sol-medium": ["gpt-5.6-sol", "medium"],
      },
    },
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

function truncateLabel(text, width) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m${String(remainder).padStart(2, "0")}s` : `${minutes}m`;
}

function formatTokenCount(tokens) {
  if (tokens === undefined) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2).replace(/\.0+$/, "")}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(tokens);
}

function formatCost(cost) {
  if (cost === undefined) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.01) {
    const precise = cost.toPrecision(3);
    return `$${precise.includes("e") ? precise : precise.replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  if (cost < 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatCompactTokenCount(tokens) {
  if (tokens === undefined) return "—";
  if (tokens >= 1_000_000_000_000) return `${Math.round(tokens / 1_000_000_000_000)}T`;
  if (tokens >= 1_000_000_000) return `${Math.round(tokens / 1_000_000_000)}B`;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function formatCompactCost(cost) {
  if (cost === undefined) return "—";
  if (cost === 0) return "$0";
  if (cost >= 1_000_000) return `$${Math.round(cost / 1_000_000)}M`;
  if (cost >= 1_000) return `$${Math.round(cost / 1_000)}k`;
  if (cost >= 100) return `$${Math.round(cost)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.1) return `$${cost.toFixed(2)}`;
  if (cost < 0.0001) return `$${cost.toExponential(0)}`;
  return formatCost(cost).replace(/^\$0\./, "$.");
}

function shortModelName(model) {
  return model.replace(/^gpt-\d+(?:\.\d+)*-/, "");
}

const ROLE_ALIASES = {
  mechanical: "MEC",
  explorer: "EXP",
  implementer: "IMP",
  architect: "ARC",
  reviewer: "REV",
  planner: "PLN",
};

const THINKING_ALIASES = {
  off: "OFF",
  minimal: "MIN",
  low: "L",
  medium: "M",
  high: "H",
  xhigh: "XH",
  max: "MAX",
};

function modelAlias(model) {
  const name = shortModelName(model).toLowerCase();
  if (name.includes("luna")) return "LUN";
  if (name.includes("sol")) return "SOL";
  if (name.includes("terra")) return "TER";
  if (name.includes("grok")) return "GRK";
  return name.replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase() || "???";
}

function variantAlias(variant) {
  return variant === "standard" ? "STD" : String(variant).toUpperCase();
}

function sessionEntryUsage(entry) {
  if (entry?.type === "message") return entry.message?.usage;
  if (entry?.type === "compaction" || entry?.type === "branch_summary") return entry.usage;
  return undefined;
}

function combineUsage(...items) {
  const usages = items.filter(Boolean);
  if (usages.length === 0) return undefined;
  const combined = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  let hasReasoning = false;
  let hasCacheWrite1h = false;
  for (const usage of usages) {
    combined.input += usage.input ?? 0;
    combined.output += usage.output ?? 0;
    combined.cacheRead += usage.cacheRead ?? 0;
    combined.cacheWrite += usage.cacheWrite ?? 0;
    combined.totalTokens += usage.totalTokens ?? 0;
    combined.cost.input += usage.cost?.input ?? 0;
    combined.cost.output += usage.cost?.output ?? 0;
    combined.cost.cacheRead += usage.cost?.cacheRead ?? 0;
    combined.cost.cacheWrite += usage.cost?.cacheWrite ?? 0;
    combined.cost.total += usage.cost?.total ?? 0;
    if (usage.reasoning !== undefined) {
      hasReasoning = true;
      combined.reasoning = (combined.reasoning ?? 0) + usage.reasoning;
    }
    if (usage.cacheWrite1h !== undefined) {
      hasCacheWrite1h = true;
      combined.cacheWrite1h = (combined.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    }
  }
  if (!hasReasoning) delete combined.reasoning;
  if (!hasCacheWrite1h) delete combined.cacheWrite1h;
  return combined;
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
  const scheduleWidget = dependencies.setWidgetTimeout ?? setTimeout;
  const cancelWidgetSchedule = dependencies.clearWidgetTimeout ?? clearTimeout;
  const now = dependencies.now ?? Date.now;
  let run;
  let changingModel = false;
  let completionTimer;
  let widgetTimer;
  const pendingCompletions = new Set();

  function workerSnapshot(worker, status = worker.status) {
    return {
      id: worker.id,
      role: worker.role,
      task: worker.task,
      cwd: worker.cwd,
      provider: worker.provider,
      model: worker.model,
      thinking: worker.thinking,
      routeOverride: worker.routeOverride,
      status,
      startedAt: worker.startedAt,
      completedAt: worker.completedAt,
      timeoutSeconds: worker.timeoutSeconds,
      displayNumber: worker.displayNumber,
      usage: worker.usage,
      pendingUsage: worker.pendingUsage,
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
    ctx.ui.setWidget("pi-minions-workers", (_tui, theme) => ({
      render(width) {
        const workers = snapshot.workers ?? [];
        const activeWorkers = workers.filter((worker) => worker.status === "in-flight");
        const branchUsage = (ctx.sessionManager.getBranch?.() ?? []).map(sessionEntryUsage);
        const sessionUsage = combineUsage(...branchUsage, ...workers.map((worker) => worker.pendingUsage));
        const sessionTokens = sessionUsage?.totalTokens ?? 0;
        const sessionCost = sessionUsage?.cost?.total ?? 0;
        if (width < 24) return [theme.fg("warning", truncateLabel("MINIONS: widen terminal", width))];

        const variant = variantAlias(snapshot.variant);
        const compact = width < 48;
        const wide = width >= 80;
        const lines = compact
          ? [`${theme.fg("accent", theme.bold(`M-${variant} ${activeWorkers.length}/6`))} ${theme.fg("text", `Σ${formatCompactTokenCount(sessionTokens)} ${formatCompactCost(sessionCost)}`)}`]
          : [`${theme.fg("accent", theme.bold(`MINIONS ${variant} ${activeWorkers.length}/6`))}${theme.fg("dim", " │ ")}${theme.fg("text", `SESSION ${formatTokenCount(sessionTokens)} · ${formatCost(sessionCost)}`)}`];

        for (const worker of activeWorkers) {
          const tokens = formatTokenCount(worker.usage?.totalTokens);
          const cost = formatCost(worker.usage?.cost?.total);
          if (compact) {
            lines.push(`${theme.fg("success", "●")}${theme.fg("accent", `W${worker.displayNumber} ${ROLE_ALIASES[worker.role] ?? "???"} ${modelAlias(worker.model)}`)} ${theme.fg("text", `${formatCompactTokenCount(worker.usage?.totalTokens)} ${formatCompactCost(worker.usage?.cost?.total)}`)}`);
            continue;
          }

          const role = wide ? worker.role : (ROLE_ALIASES[worker.role] ?? worker.role);
          const model = truncateLabel(shortModelName(worker.model), wide ? 18 : 10);
          const thinking = wide ? worker.thinking : (THINKING_ALIASES[worker.thinking] ?? worker.thinking);
          const parts = [
            theme.fg("success", "●"),
            theme.fg("accent", `W${worker.displayNumber} ${role}`),
            theme.fg("dim", "│"),
            theme.fg("text", `${model}:${thinking}`),
            theme.fg("dim", "│"),
            theme.fg("text", tokens),
            theme.fg("dim", "│"),
            theme.fg("text", cost),
          ];
          if (wide) {
            const elapsedSeconds = Math.max(0, Math.floor((now() - worker.startedAt) / 1000));
            parts.push(theme.fg("dim", "│"), theme.fg("muted", formatElapsed(elapsedSeconds)));
          }
          lines.push(parts.join(" "));
        }
        return lines;
      },
      invalidate() {},
    }), { placement: "aboveEditor" });
  }

  function updateWorkerWidget(ctx) {
    if (!run) {
      if (widgetTimer !== undefined) cancelWidgetSchedule(widgetTimer);
      widgetTimer = undefined;
      return renderWorkerWidget(ctx, undefined);
    }
    renderWorkerWidget(ctx, {
      provider: run.provider,
      variant: run.variant,
      workers: [...run.workers.values()].map((worker) => workerSnapshot(worker)),
    });
    const hasActiveWorkers = [...run.workers.values()].some((worker) => worker.status === "in-flight");
    if (!hasActiveWorkers) {
      if (widgetTimer !== undefined) cancelWidgetSchedule(widgetTimer);
      widgetTimer = undefined;
      return;
    }
    if (widgetTimer !== undefined) return;
    widgetTimer = scheduleWidget(() => {
      widgetTimer = undefined;
      if (run) updateWorkerWidget(ctx);
    }, 1000);
    widgetTimer?.unref?.();
  }

  function notifyCompletion(worker, ctx) {
    pendingCompletions.add(worker.id);
    if (completionTimer) return;
    completionTimer = schedule(() => {
      completionTimer = undefined;
      const ids = [...pendingCompletions];
      pendingCompletions.clear();
      if (!run || ids.length === 0) return;
      const completedWorkers = ids.map((id) => run.workers.get(id)).filter(Boolean);
      const summary = completedWorkers
        .map((item) => `W${item.displayNumber} ${item.status === "done" ? "completed" : item.status}`)
        .join(" · ");
      ctx.ui?.notify?.(summary, completedWorkers.some((item) => item.status === "blocked") ? "warning" : "info");
      pi.sendMessage({
        customType: "pi-minions-completion",
        content: `Worker completion notification: ${ids.join(", ")}. Read each worker, update the board, and dispatch newly unblocked work.`,
        display: true,
        details: { runId: run.id, workerIds: ids },
      }, { deliverAs: "steer", triggerTurn: true });
    }, 50);
  }

  function startWorker(spec, ctx) {
    const matrix = PROVIDER_MATRICES[run.provider]?.[run.variant];
    const roleRoute = matrix?.routes[spec.role];
    if (!roleRoute) throw new Error(`Unknown worker role: ${spec.role}`);
    const route = spec.routeOverride ? matrix.overrides[spec.routeOverride] : roleRoute;
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
      routeOverride: spec.routeOverride,
      displayNumber: run.nextWorkerNumber++,
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
      worker.completedAt = now();
      if (error) worker.error = error;
      persistRun();
      updateWorkerWidget(ctx);
      if (status !== "stopped") notifyCompletion(worker, ctx);
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
        worker.usage = combineUsage(worker.usage, event.message.usage);
        worker.pendingUsage = combineUsage(worker.pendingUsage, event.message.usage);
        worker.stopReason = event.message.stopReason;
        updateWorkerWidget(ctx);
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
      if (!SUPPORTED_VARIANTS.has(variant)) throw new Error(`Unknown minions variant: ${variant}`);
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
      const matrix = PROVIDER_MATRICES[provider][variant];
      const missing = matrix.requiredModels.filter((id) => !ctx.modelRegistry.find(provider, id));
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
        nextWorkerNumber: 1,
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
        workers: workers.map(({ id, role, cwd, provider, model, thinking, routeOverride, status }) => ({ id, role, cwd, provider, model, thinking, routeOverride, status })),
      });
    },
  });

  pi.registerTool({
    name: "minions_read",
    label: "Read Minions",
    description: "Read status and final output from managed Pi workers.",
    parameters: schemas.read ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!run) throw new Error("No orchestration run is active.");
      const ids = params.workerIds?.length ? params.workerIds : [...run.workers.keys()];
      const selectedWorkers = ids.map((id) => {
        const worker = run.workers.get(id);
        if (!worker) throw new Error(`Unknown worker: ${id}`);
        return worker;
      });
      const workers = selectedWorkers.map((worker) => {
        const { id, role, task, cwd, provider, model, thinking, routeOverride, timeoutSeconds, status, output, progress, currentTool, stderr, error, exitCode, usage, stopReason } = worker;
        return { id, role, task, cwd, provider, model, thinking, routeOverride, timeoutSeconds, status, output, progress, currentTool, stderr, error, exitCode, usage, stopReason };
      });
      const summaries = workers.map((worker) => {
        const activity = worker.currentTool ? `Running ${worker.currentTool}${worker.progress ? `\n${worker.progress}` : ""}` : worker.progress;
        const body = worker.error || (worker.currentTool ? activity : undefined) || worker.output || worker.stderr || activity || "(no output yet)";
        return `### ${worker.id} · ${worker.role} · ${worker.status}\n${body}`;
      });
      const usage = combineUsage(...selectedWorkers.map((worker) => worker.pendingUsage));
      for (const worker of selectedWorkers) worker.pendingUsage = undefined;
      updateWorkerWidget(ctx);
      const result = textResult(truncateForContext(summaries.join("\n\n")), { workers });
      if (usage) result.usage = usage;
      return result;
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
        worker.completedAt = now();
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
      const pendingUsage = combineUsage(...[...closing.workers.values()].map((worker) => worker.pendingUsage));
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
      const result = textResult(`Closed orchestration ${closing.id} and restored the original model.`, { runId: closing.id });
      if (pendingUsage) result.usage = pendingUsage;
      return result;
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
    for (const entry of ctx.sessionManager.getEntries?.() ?? []) {
      if (entry.type !== "custom") continue;
      if (entry.customType === "pi-minions-reload-interrupted") interrupted = entry.data;
      if (entry.customType === "pi-minions-reload-notified") interrupted = undefined;
    }
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

  pi.on("session_shutdown", (event, ctx) => {
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
      worker.completedAt = now();
      try { worker.process.stdin.write(`${JSON.stringify({ type: "abort" })}\n`); } catch {}
      worker.process.kill?.("SIGTERM");
    }
    persistRun(event.reason === "reload" ? "interrupted" : "closed", event.reason === "reload" ? "interrupted" : undefined);
    run = undefined;
    if (widgetTimer !== undefined) cancelWidgetSchedule(widgetTimer);
    widgetTimer = undefined;
    renderWorkerWidget(ctx, undefined);
  });
}
