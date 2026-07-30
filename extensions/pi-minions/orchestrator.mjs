import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SUPPORTED_PROVIDERS = new Set(["openai-codex", "github-copilot"]);
const SUPPORTED_VARIANTS = new Set(["standard", "lb"]);
const SUBAGENTS_RPC_VERSION = 1;
const SUBAGENTS_RPC_REQUEST = "subagents:rpc:v1:request";
const SUBAGENTS_RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const SUBAGENTS_ASYNC_COMPLETE = "subagent:async-complete";
const MAX_IN_FLIGHT = 6;
const MAX_TRIAGED_RESULTS = 8;
const MAX_WORKER_LAUNCHES = 12;
const WRITER_ROLES = new Set(["implementer", "architect"]);
const REQUIRED_RPC_METHODS = ["ping", "status", "spawn", "steer", "stop", "resume"];
const ROLE_AGENTS = {
  mechanical: "pi-minions-mechanical",
  explorer: "pi-minions-explorer",
  implementer: "pi-minions-implementer",
  architect: "pi-minions-architect",
  reviewer: "pi-minions-reviewer",
  planner: "pi-minions-planner",
};

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

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

function truncateForContext(text, maxBytes = 50 * 1024) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end--;
  return `${text.slice(0, end)}\n\n[Output truncated for parent context; full output remains in pi-subagents artifacts.]`;
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
  }
  return combined;
}

function sumCostSummaries(payload) {
  const summaries = payload?.totalCost && typeof payload.totalCost === "object"
    ? [payload.totalCost]
    : (payload?.results ?? []).map((item) => item?.totalCost)
      .filter((item) => item && typeof item === "object");
  if (summaries.length === 0) return undefined;
  return summaries.reduce((total, item) => ({
    inputTokens: total.inputTokens + (Number(item.inputTokens) || 0),
    outputTokens: total.outputTokens + (Number(item.outputTokens) || 0),
    costUsd: total.costUsd + (Number(item.costUsd) || 0),
  }), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
}

function usageFromCompletion(payload) {
  const cost = sumCostSummaries(payload);
  const tokens = payload?.totalTokens;
  const input = Number(tokens?.input ?? cost?.inputTokens) || 0;
  const output = Number(tokens?.output ?? cost?.outputTokens) || 0;
  const totalTokens = Math.max(Number(tokens?.total) || 0, input + output);
  const costUsd = Number(cost?.costUsd) || 0;
  if (totalTokens === 0 && costUsd === 0) return undefined;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costUsd },
  };
}

function completionOutput(payload) {
  if (typeof payload?.summary === "string" && payload.summary.trim()) return payload.summary.trim();
  if (!Array.isArray(payload?.results)) return "";
  return payload.results.map((item) => {
    const body = item?.output ?? item?.summary ?? item?.error ?? "(no output)";
    return item?.agent ? `### ${item.agent}\n${body}` : String(body);
  }).join("\n\n");
}

function completionError(payload) {
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
  const failures = (payload?.results ?? [])
    .filter((item) => item?.success === false || item?.error)
    .map((item) => item?.error ?? `${item?.agent ?? "worker"} failed`);
  return failures.length > 0 ? failures.join("; ") : undefined;
}

function completionStatus(payload) {
  if (payload?.state === "stopped" || payload?.stopped === true) return "stopped";
  if (payload?.state === "paused" || payload?.interrupted === true) return "paused";
  if (payload?.success === true || payload?.state === "complete" || payload?.state === "completed") return "done";
  return "blocked";
}

function parseStatusText(text) {
  const state = text.match(/^State:\s*(\S+)/m)?.[1]?.toLowerCase();
  const error = text.match(/^Error:\s*(.+)$/m)?.[1]?.trim();
  const separator = text.indexOf("\n\n");
  const output = separator >= 0 ? text.slice(separator + 2).trim() : "";
  return { state, error, output };
}

function defaultReadLifecycle(worker) {
  if (!worker.asyncDir) return undefined;
  try {
    const lifecycle = JSON.parse(fs.readFileSync(path.join(worker.asyncDir, "status.json"), "utf8"));
    if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return undefined;
    const outputFile = lifecycle.outputFile;
    if (typeof outputFile !== "string" || !outputFile.trim()) return lifecycle;
    const outputPath = path.isAbsolute(outputFile)
      ? outputFile
      : path.join(worker.asyncDir, outputFile);
    try {
      const summary = fs.readFileSync(outputPath, "utf8").trim();
      return summary ? { ...lifecycle, summary } : lifecycle;
    } catch {
      return lifecycle;
    }
  } catch {
    return undefined;
  }
}

function normalizeGitPath(cwd, value) {
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return path.normalize(absolute);
  }
}

function defaultValidateWriterCwd(cwd) {
  if (!path.isAbsolute(cwd)) return "Writer cwd must be an absolute isolated worktree path.";
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return `Writer cwd does not exist: ${cwd}`;
  try {
    const gitDir = execFileSync("git", ["-C", cwd, "rev-parse", "--git-dir"], { encoding: "utf8" }).trim();
    const commonDir = execFileSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    if (normalizeGitPath(cwd, gitDir) === normalizeGitPath(cwd, commonDir)) {
      return `Writer cwd is the primary checkout, not an isolated git worktree: ${cwd}`;
    }
  } catch (error) {
    return `Unable to verify writer worktree ${cwd}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return true;
}

function defaultResolveDiscipline(name, cwd) {
  const piRoot = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  const candidates = [
    path.join(piRoot, "skills", name, "SKILL.md"),
    path.join(os.homedir(), ".agents", "skills", name, "SKILL.md"),
    path.join(cwd, ".pi", "skills", name, "SKILL.md"),
    path.join(cwd, ".agents", "skills", name, "SKILL.md"),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function requestedDiscipline(task) {
  return task.match(/Discipline:\s*load\s+([a-z0-9-]+)\s+if available/i)?.[1];
}

function activeStatus(status) {
  return status === "in-flight" || status === "stopping";
}

export function createPiMinionsExtension(pi, dependencies = {}) {
  const schemas = dependencies.schemas ?? {};
  const now = dependencies.now ?? Date.now;
  const idFactory = dependencies.idFactory ?? randomUUID;
  const validateWriterCwd = dependencies.validateWriterCwd ?? defaultValidateWriterCwd;
  const resolveDiscipline = dependencies.resolveDiscipline ?? defaultResolveDiscipline;
  const readLifecycle = dependencies.readLifecycle ?? defaultReadLifecycle;
  const setRpcTimeout = dependencies.setRpcTimeout ?? setTimeout;
  const clearRpcTimeout = dependencies.clearRpcTimeout ?? clearTimeout;
  const rpcTimeoutMs = dependencies.rpcTimeoutMs ?? 10_000;
  let run;
  let runtimeInfo;
  let changingModel = false;
  let lastContext;
  const earlyCompletions = new Map();

  function workerSnapshot(worker) {
    return {
      id: worker.id,
      subagentRunId: worker.subagentRunId,
      asyncDir: worker.asyncDir,
      role: worker.role,
      agent: worker.agent,
      task: worker.task,
      cwd: worker.cwd,
      provider: worker.provider,
      model: worker.model,
      thinking: worker.thinking,
      routeOverride: worker.routeOverride,
      status: worker.status,
      startedAt: worker.startedAt,
      completedAt: worker.completedAt,
      timeoutSeconds: worker.timeoutSeconds,
      displayNumber: worker.displayNumber,
      output: worker.output,
      progress: worker.progress,
      error: worker.error,
      usage: worker.usage,
      pendingUsage: worker.pendingUsage,
      discipline: worker.discipline,
      disciplineLoaded: worker.disciplineLoaded,
      observedRunIds: [...(worker.observedRunIds ?? [])],
      triagedRunIds: [...(worker.triagedRunIds ?? [])],
    };
  }

  function persistRun(lifecycle = "active") {
    if (!run) return;
    pi.appendEntry("pi-minions-state", {
      runId: run.id,
      provider: run.provider,
      variant: run.variant,
      lifecycle,
      originalModel: run.originalModel,
      originalThinking: run.originalThinking,
      nextWorkerNumber: run.nextWorkerNumber,
      launchCount: run.launchCount,
      triagedCount: run.triagedCount,
      workers: [...run.workers.values()].map(workerSnapshot),
    });
  }

  function restoreRun(ctx) {
    let latest;
    for (const entry of ctx.sessionManager.getEntries?.() ?? []) {
      if (entry.type === "custom" && entry.customType === "pi-minions-state") latest = entry.data;
    }
    if (!latest || latest.lifecycle !== "active") return;
    if (!SUPPORTED_PROVIDERS.has(latest.provider) || !SUPPORTED_VARIANTS.has(latest.variant)) return;
    const workers = new Map();
    for (const snapshot of latest.workers ?? []) {
      if (!snapshot?.id || !snapshot?.subagentRunId || !ROLE_AGENTS[snapshot.role]) continue;
      workers.set(snapshot.id, {
        ...snapshot,
        observedRunIds: new Set(snapshot.observedRunIds ?? []),
        triagedRunIds: new Set(snapshot.triagedRunIds ?? []),
      });
    }
    run = {
      id: latest.runId,
      provider: latest.provider,
      variant: latest.variant,
      originalModel: latest.originalModel,
      originalThinking: latest.originalThinking,
      nextWorkerNumber: latest.nextWorkerNumber ?? Math.max(0, ...[...workers.values()].map((worker) => worker.displayNumber ?? 0)) + 1,
      launchCount: latest.launchCount ?? workers.size,
      triagedCount: latest.triagedCount ?? [...workers.values()]
        .reduce((total, worker) => total + worker.triagedRunIds.size, 0),
      workers,
    };
    ctx.ui?.setStatus?.("pi-minions", `${run.provider} · ${run.variant} · recovered`);
  }

  function cleanupListener(event, handler, subscription) {
    if (typeof subscription === "function") subscription();
    else pi.events?.off?.(event, handler);
  }

  function rpcCall(method, params) {
    if (!pi.events?.on || !pi.events?.emit) {
      return Promise.reject(new Error("Pi does not expose the event bus required by pi-subagents."));
    }
    const requestId = idFactory();
    const replyEvent = `${SUBAGENTS_RPC_REPLY_PREFIX}${requestId}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearRpcTimeout(timer);
        cleanupListener(replyEvent, onReply, subscription);
        callback();
      };
      const onReply = (reply) => finish(() => {
        if (reply?.success) resolve(reply.data);
        else {
          const code = reply?.error?.code ? ` (${reply.error.code})` : "";
          reject(new Error(`pi-subagents RPC ${method} failed${code}: ${reply?.error?.message ?? "unknown error"}`));
        }
      });
      const subscription = pi.events.on(replyEvent, onReply);
      timer = setRpcTimeout(() => finish(() => reject(new Error(
        `pi-subagents did not answer RPC ${method}. Install the pinned runtime with: pi install npm:pi-subagents@0.37.2`,
      ))), rpcTimeoutMs);
      timer?.unref?.();
      pi.events.emit(SUBAGENTS_RPC_REQUEST, {
        version: SUBAGENTS_RPC_VERSION,
        requestId,
        method,
        ...(params === undefined ? {} : { params }),
        source: { extension: "copilot-minions" },
      });
    });
  }

  async function ensureRuntime() {
    if (runtimeInfo) return runtimeInfo;
    const info = await rpcCall("ping");
    const methods = new Set(info?.methods ?? []);
    const missing = REQUIRED_RPC_METHODS.filter((method) => !methods.has(method));
    if (info?.version !== SUBAGENTS_RPC_VERSION || missing.length > 0 || info?.capabilities?.asyncSpawn !== true) {
      throw new Error(`Incompatible pi-subagents RPC runtime${missing.length ? `; missing: ${missing.join(", ")}` : ""}. Install npm:pi-subagents@0.37.2.`);
    }
    if (
      info?.capabilities?.nonRecoveringSteer !== true
      || info?.capabilities?.processTerminalProof?.version !== 1
      || info?.capabilities?.processTerminalProof?.lifecycleArtifactVersion !== 1
    ) {
      throw new Error("Incompatible pi-subagents runtime: Minions requires non-recovering steering and lifecycle artifact v1.");
    }
    if (info?.events?.asyncComplete !== SUBAGENTS_ASYNC_COMPLETE) {
      throw new Error("Incompatible pi-subagents completion event contract.");
    }
    runtimeInfo = info;
    return info;
  }

  function resolveWorkerRoute(spec, ctx) {
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
    const cwd = spec.cwd ?? ctx.cwd;
    if (WRITER_ROLES.has(spec.role)) {
      if (!spec.cwd) throw new Error(`${spec.role} workers require an explicit isolated worktree cwd.`);
      const validation = validateWriterCwd(cwd);
      if (validation !== true) throw new Error(typeof validation === "string" ? validation : `Invalid writer worktree: ${cwd}`);
    }
    const discipline = requestedDiscipline(spec.task);
    const disciplineLoaded = Boolean(discipline && resolveDiscipline(discipline, cwd));
    return {
      modelId,
      thinking,
      cwd,
      agent: ROLE_AGENTS[spec.role],
      discipline,
      disciplineLoaded,
    };
  }

  function spawnParams(spec, route) {
    return {
      agent: route.agent,
      task: spec.task,
      cwd: route.cwd,
      context: "fresh",
      model: `${run.provider}/${route.modelId}:${route.thinking}`,
      async: true,
      clarify: false,
      artifacts: true,
      ...(spec.timeoutSeconds ? { timeoutMs: spec.timeoutSeconds * 1_000 } : {}),
      ...(route.disciplineLoaded ? { skill: route.discipline } : {}),
      control: {
        enabled: true,
        notifyOn: ["active_long_running", "needs_attention"],
        notifyChannels: ["event"],
      },
    };
  }

  function findWorkerBySubagentRunId(subagentRunId) {
    if (!run || !subagentRunId) return undefined;
    return [...run.workers.values()].find((worker) => worker.subagentRunId === subagentRunId);
  }

  function applyCompletion(worker, payload, ctx) {
    const subagentRunId = payload?.runId ?? payload?.id ?? worker.subagentRunId;
    worker.observedRunIds ??= new Set();
    const firstObservation = !worker.observedRunIds.has(subagentRunId);
    worker.observedRunIds.add(subagentRunId);
    worker.status = completionStatus(payload);
    worker.completedAt = Number(payload?.timestamp) || Number(payload?.endedAt) || now();
    worker.output = completionOutput(payload) || worker.output;
    worker.progress = undefined;
    worker.error = completionError(payload);
    if (firstObservation) {
      const usage = usageFromCompletion(payload);
      worker.usage = combineUsage(worker.usage, usage);
      worker.pendingUsage = combineUsage(worker.pendingUsage, usage);
    }
    persistRun();
    ctx?.ui?.setStatus?.("pi-minions", `${run.provider} · ${run.variant}`);
  }

  function onAsyncComplete(payload) {
    const subagentRunId = payload?.runId ?? payload?.id;
    const worker = findWorkerBySubagentRunId(subagentRunId);
    if (!worker) {
      if (subagentRunId) {
        earlyCompletions.set(subagentRunId, payload);
        while (earlyCompletions.size > 32) earlyCompletions.delete(earlyCompletions.keys().next().value);
      }
      return;
    }
    applyCompletion(worker, payload, lastContext);
  }

  const completionListenerKey = Symbol.for("copilot-minions.pi-subagents-completion-listener");
  const previousCompletionListener = globalThis[completionListenerKey];
  if (typeof previousCompletionListener === "function") previousCompletionListener();
  const completionSubscription = pi.events?.on?.(SUBAGENTS_ASYNC_COMPLETE, onAsyncComplete);
  let completionListenerDisposed = false;
  const disposeCompletionListener = () => {
    if (completionListenerDisposed) return;
    completionListenerDisposed = true;
    cleanupListener(SUBAGENTS_ASYNC_COMPLETE, onAsyncComplete, completionSubscription);
    if (globalThis[completionListenerKey] === disposeCompletionListener) {
      delete globalThis[completionListenerKey];
    }
  };
  globalThis[completionListenerKey] = disposeCompletionListener;

  async function refreshWorker(worker, ctx) {
    if (!activeStatus(worker.status)) return;
    const data = await rpcCall("status", { id: worker.subagentRunId });
    const text = typeof data?.text === "string" ? data.text : "";
    const parsed = parseStatusText(text);
    worker.progress = text;
    if (["complete", "completed", "failed", "stopped", "paused"].includes(parsed.state)) {
      const lifecycle = readLifecycle(worker);
      const summary = lifecycle?.summary || parsed.output;
      applyCompletion(worker, {
        ...(lifecycle ?? {}),
        runId: worker.subagentRunId,
        state: lifecycle?.state ?? parsed.state,
        ...(summary ? { summary } : {}),
        ...(lifecycle?.error || parsed.error ? { error: lifecycle?.error ?? parsed.error } : {}),
      }, ctx);
      if (worker.status === "blocked" && !worker.error) {
        worker.error = "pi-subagents reported a failed run.";
      }
    }
  }

  pi.registerTool({
    name: "minions_start",
    label: "Start Minions",
    description: "Start one provider-affine Pi orchestration run backed by pi-subagents.",
    parameters: schemas.start ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
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
      await ensureRuntime();

      const frontier = ctx.modelRegistry.find(provider, "gpt-5.6-sol");
      const originalModel = ctx.model;
      const originalThinking = pi.getThinkingLevel();
      if (!(await pi.setModel(frontier))) throw new Error(`Unable to select ${provider}/gpt-5.6-sol.`);
      pi.setThinkingLevel("medium");
      run = {
        id: idFactory(),
        provider,
        variant,
        originalModel,
        originalThinking,
        workers: new Map(),
        nextWorkerNumber: 1,
        launchCount: 0,
        triagedCount: 0,
      };
      ctx.ui?.setStatus?.("pi-minions", `${provider} · ${variant}`);
      persistRun();
      return textResult(`Started ${variant} orchestration with Provider Affinity ${provider} on pi-subagents RPC v1.`, {
        runId: run.id,
        provider,
        variant,
        frontier: "gpt-5.6-sol",
        thinking: "medium",
        runtime: "pi-subagents",
      });
    },
  });

  pi.registerTool({
    name: "minions_spawn",
    label: "Spawn Minions",
    description: "Spawn up to six persistent background workers using role routing.",
    parameters: schemas.spawn ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("Start an orchestration run before spawning workers.");
      await ensureRuntime();
      const tasks = params.tasks ?? [];
      if (tasks.length === 0) throw new Error("At least one worker task is required.");
      const inFlight = [...run.workers.values()].filter((worker) => activeStatus(worker.status)).length;
      if (inFlight + tasks.length > MAX_IN_FLIGHT) throw new Error(`Pi minions allows at most ${MAX_IN_FLIGHT} in-flight workers.`);
      if (run.triagedCount >= MAX_TRIAGED_RESULTS) {
        throw new Error(`Pi minions reached its ${MAX_TRIAGED_RESULTS}-result triage budget; close and start a new orchestration run.`);
      }
      if (run.launchCount + tasks.length > MAX_WORKER_LAUNCHES) {
        throw new Error(`Pi minions allows at most ${MAX_WORKER_LAUNCHES} worker launches per orchestration run.`);
      }
      const routes = tasks.map((task) => resolveWorkerRoute(task, ctx));
      const settled = await Promise.allSettled(tasks.map((task, index) => rpcCall("spawn", spawnParams(task, routes[index]))));
      const successfulRuns = settled
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value?.details?.asyncId)
        .filter(Boolean);
      const failure = settled.find((result) => result.status === "rejected" || !result.value?.details?.asyncId);
      if (failure) {
        run.launchCount += successfulRuns.length;
        persistRun();
        await Promise.allSettled(successfulRuns.map((id) => rpcCall("stop", { id })));
        const reason = failure.status === "rejected"
          ? failure.reason
          : new Error("pi-subagents spawn reply did not include an async run id.");
        throw reason;
      }

      const workers = settled.map((result, index) => {
        const data = result.value;
        const route = routes[index];
        const task = tasks[index];
        const worker = {
          id: idFactory(),
          subagentRunId: data.details.asyncId,
          asyncDir: data.details.asyncDir,
          role: task.role,
          agent: route.agent,
          task: task.task,
          cwd: route.cwd,
          provider: run.provider,
          model: route.modelId,
          thinking: route.thinking,
          routeOverride: task.routeOverride,
          displayNumber: run.nextWorkerNumber++,
          status: "in-flight",
          startedAt: now(),
          timeoutSeconds: task.timeoutSeconds,
          output: "",
          observedRunIds: new Set(),
          triagedRunIds: new Set(),
          discipline: route.discipline,
          disciplineLoaded: route.disciplineLoaded,
        };
        run.workers.set(worker.id, worker);
        const early = earlyCompletions.get(worker.subagentRunId);
        if (early) {
          earlyCompletions.delete(worker.subagentRunId);
          applyCompletion(worker, early, ctx);
        }
        return worker;
      });
      run.launchCount += workers.length;
      persistRun();
      return textResult(
        `Spawned ${workers.length} persistent worker(s): ${workers.map((worker) => `${worker.role} ${worker.id}`).join(", ")}. End this turn now; do not poll. pi-subagents will notify this session on completion.`,
        { workers: workers.map(workerSnapshot) },
      );
    },
  });

  pi.registerTool({
    name: "minions_read",
    label: "Read Minions",
    description: "Read status and final output from managed pi-subagents workers.",
    parameters: schemas.read ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("No orchestration run is active.");
      const ids = params.workerIds?.length ? params.workerIds : [...run.workers.keys()];
      const selected = ids.map((id) => {
        const worker = run.workers.get(id);
        if (!worker) throw new Error(`Unknown worker: ${id}`);
        return worker;
      });
      if (selected.some((worker) => activeStatus(worker.status))) {
        await ensureRuntime();
        await Promise.all(selected.map(async (worker) => {
          try {
            await refreshWorker(worker, ctx);
          } catch (error) {
            worker.progress = `Status refresh unavailable: ${error instanceof Error ? error.message : String(error)}`;
          }
        }));
        persistRun();
      }
      for (const worker of selected) {
        worker.triagedRunIds ??= new Set();
        if (!activeStatus(worker.status) && !worker.triagedRunIds.has(worker.subagentRunId)) {
          worker.triagedRunIds.add(worker.subagentRunId);
          run.triagedCount += 1;
        }
      }
      const workers = selected.map(workerSnapshot);
      const summaries = workers.map((worker) => {
        const body = worker.error || worker.output || worker.progress || "(no output yet)";
        const discipline = worker.discipline
          ? ` · discipline ${worker.discipline}${worker.disciplineLoaded ? "" : " fallback"}`
          : "";
        return `### ${worker.id} · ${worker.role} · ${worker.status}${discipline}\n${body}`;
      });
      const usage = combineUsage(...selected.map((worker) => worker.pendingUsage));
      for (const worker of selected) worker.pendingUsage = undefined;
      persistRun();
      const result = textResult(truncateForContext(summaries.join("\n\n")), { workers });
      if (usage) result.usage = usage;
      return result;
    },
  });

  pi.registerTool({
    name: "minions_steer",
    label: "Steer Minion",
    description: "Send acknowledged guidance to a live pi-subagents worker.",
    parameters: schemas.steer ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("No orchestration run is active.");
      const worker = run.workers.get(params.workerId);
      if (!worker) throw new Error(`Unknown worker: ${params.workerId}`);
      if (worker.status !== "in-flight") throw new Error(`Worker ${params.workerId} is not in flight.`);
      await ensureRuntime();
      const data = await rpcCall("steer", { id: worker.subagentRunId, message: params.message });
      return textResult(data?.text || `Steering acknowledged for worker ${worker.id}.`, {
        workerId: worker.id,
        subagentRunId: worker.subagentRunId,
      });
    },
  });

  pi.registerTool({
    name: "minions_resume",
    label: "Resume Minion",
    description: "Revive a paused, failed, or completed worker with a follow-up message.",
    parameters: schemas.resume ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("No orchestration run is active.");
      const worker = run.workers.get(params.workerId);
      if (!worker) throw new Error(`Unknown worker: ${params.workerId}`);
      if (activeStatus(worker.status) || worker.status === "stopped") {
        throw new Error(`Worker ${params.workerId} cannot be resumed from status ${worker.status}.`);
      }
      if (run.launchCount >= MAX_WORKER_LAUNCHES) {
        throw new Error(`Pi minions reached its ${MAX_WORKER_LAUNCHES}-launch worker budget.`);
      }
      await ensureRuntime();
      const data = await rpcCall("resume", { id: worker.subagentRunId, message: params.message });
      const resumedId = data?.details?.asyncId;
      if (!resumedId) throw new Error("pi-subagents resume reply did not include an async run id.");
      worker.subagentRunId = resumedId;
      worker.asyncDir = data.details.asyncDir;
      worker.status = "in-flight";
      worker.startedAt = now();
      worker.completedAt = undefined;
      worker.output = "";
      worker.progress = "";
      worker.error = undefined;
      run.launchCount += 1;
      const early = earlyCompletions.get(resumedId);
      if (early) {
        earlyCompletions.delete(resumedId);
        applyCompletion(worker, early, ctx);
      }
      persistRun();
      return textResult(`Resumed worker ${worker.id} as pi-subagents run ${resumedId}. End this turn and wait for its completion notification.`, {
        worker: workerSnapshot(worker),
      });
    },
  });

  pi.registerTool({
    name: "minions_stop",
    label: "Stop Minions",
    description: "Request a persistent stop for one or more live workers.",
    parameters: schemas.stop ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("No orchestration run is active.");
      const ids = params.workerIds?.length
        ? params.workerIds
        : [...run.workers.values()].filter((worker) => activeStatus(worker.status)).map((worker) => worker.id);
      const selected = ids.map((id) => {
        const worker = run.workers.get(id);
        if (!worker) throw new Error(`Unknown worker: ${id}`);
        return worker;
      });
      const active = selected.filter((worker) => activeStatus(worker.status));
      if (active.length > 0) {
        await ensureRuntime();
        const settled = await Promise.allSettled(active.map((worker) => rpcCall("stop", { id: worker.subagentRunId })));
        const failed = settled.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        for (const worker of active) {
          if (activeStatus(worker.status)) {
            worker.status = "stopping";
            worker.progress = "Stop requested; waiting for pi-subagents process-terminal confirmation.";
          }
        }
        persistRun();
      }
      return textResult(`Stop requested for ${active.length} live worker(s). Wait for completion before closing the orchestration.`, {
        workerIds: ids,
      });
    },
  });

  pi.registerTool({
    name: "minions_close",
    label: "Close Minions",
    description: "Close the orchestration and restore the parent's original model.",
    parameters: schemas.close ?? {},
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) return textResult("No orchestration run is active.");
      const active = [...run.workers.values()].filter((worker) => activeStatus(worker.status));
      if (active.length > 0) throw new Error(`Cannot close with ${active.length} live worker(s).`);
      const closing = run;
      const originalModel = closing.originalModel
        ? ctx.modelRegistry.find(closing.originalModel.provider, closing.originalModel.id)
        : undefined;
      if (closing.originalModel && !originalModel) {
        throw new Error(`Unable to restore unavailable model ${closing.originalModel.provider}/${closing.originalModel.id}.`);
      }
      if (originalModel) {
        changingModel = true;
        try {
          if (!(await pi.setModel(originalModel))) {
            throw new Error(`Unable to restore ${closing.originalModel.provider}/${closing.originalModel.id}.`);
          }
          pi.setThinkingLevel(closing.originalThinking);
        } finally {
          changingModel = false;
        }
      }
      const pendingUsage = combineUsage(...[...closing.workers.values()].map((worker) => worker.pendingUsage));
      persistRun("closed");
      run = undefined;
      ctx.ui?.setStatus?.("pi-minions", undefined);
      const result = textResult(`Closed orchestration ${closing.id} and restored the original model. pi-subagents artifacts and resumable sessions remain available.`, {
        runId: closing.id,
      });
      if (pendingUsage) result.usage = pendingUsage;
      return result;
    },
  });

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

  pi.on("before_agent_start", (event, ctx) => {
    lastContext = ctx;
    return {
      systemPrompt: `${event.systemPrompt}

Pi harness routing: use pi-minions or pi-minions-lb for top-level orchestration. The minions tools delegate to the installed pi-subagents runtime; never call the generic subagent tool directly for top-level dispatch because minions owns provider affinity, role routing, budgets, and board identity. You may use subagent_supervisor only to answer a managed worker request. After minions_spawn or minions_resume, end the turn immediately. A pi-subagents background completion notification means you must call minions_read, update the board, and dispatch newly unblocked work.`,
    };
  });

  pi.on("model_select", async (event, ctx) => {
    lastContext = ctx;
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
    lastContext = ctx;
    if (!run || changingModel || event.level === "medium") return;
    pi.setThinkingLevel("medium");
    ctx.ui?.notify?.("Thinking level locked to medium while Pi minions is active.", "warning");
  });

  pi.on("session_start", (_event, ctx) => {
    lastContext = ctx;
    runtimeInfo = undefined;
    if (!run) restoreRun(ctx);
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    lastContext = ctx;
    if (!run) return;
    ctx.ui?.notify?.("Close the active Pi minions orchestration before changing sessions.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    lastContext = ctx;
    if (!run) return;
    ctx.ui?.notify?.("Close the active Pi minions orchestration before forking the session.", "warning");
    return { cancel: true };
  });

  pi.on("session_shutdown", (event) => {
    runtimeInfo = undefined;
    if (run) persistRun();
    if (event.reason === "reload") disposeCompletionListener();
  });
}
