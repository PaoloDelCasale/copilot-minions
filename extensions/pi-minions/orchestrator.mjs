import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPaseoRuntimeFromProcess } from "./paseo-runtime.mjs";
import { createOrcaRuntimeFromProcess } from "./orca-runtime.mjs";

const SUPPORTED_PROVIDERS = new Set(["openai-codex", "github-copilot"]);
const SUPPORTED_VARIANTS = new Set(["standard", "lb"]);
const SUPPORTED_RUNTIMES = new Set(["pi-subagents", "paseo", "orca"]);
const SUBAGENTS_RPC_VERSION = 1;
const SUBAGENTS_RPC_REQUEST = "subagents:rpc:v1:request";
const SUBAGENTS_RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const SUBAGENTS_ASYNC_COMPLETE = "subagent:async-complete";
const MAX_IN_FLIGHT = 6;
const SOFT_TRIAGED_RESULTS = 8;
const MAX_TRIAGED_RESULTS = 30;
const MAX_WORKER_LAUNCHES = 30;
const BUDGET_CLASSES = new Set(["normal", "closure"]);
const CLOSURE_ROLES = new Set(["mechanical", "implementer", "architect", "reviewer"]);
const MECHANICAL_JUDGMENT_REASONS = new Set(["merge-conflict", "github-judgment"]);
const ESCALATION_REASONS = new Set([
  "worker-failure",
  "verification-failure",
  "blocked",
  "review-changes-required",
  "mediocre-result",
]);
const WRITER_ROLES = new Set(["implementer", "architect"]);
const DEFAULT_WATCHDOG_INTERVAL_MS = 15_000;
const DEFAULT_PASEO_ERROR_SETTLE_MS = 120_000;
const DEFAULT_RUN_COST_CEILING_USD = 160;
const MODEL_BUDGETS = {
  "claude-opus-5": { warningCostUsd: 40, maxCostUsd: 60, maxDurationSeconds: 50 * 60 },
  "gpt-5.6-luna": { warningCostUsd: 16, maxCostUsd: 24, maxDurationSeconds: 30 * 60 },
  "gpt-5.6-sol": { warningCostUsd: 40, maxCostUsd: 60, maxDurationSeconds: 45 * 60 },
  "gpt-5.6-terra": { warningCostUsd: 24, maxCostUsd: 40, maxDurationSeconds: 35 * 60 },
  "grok-4.5": { warningCostUsd: 24, maxCostUsd: 40, maxDurationSeconds: 35 * 60 },
};
const REQUIRED_RPC_METHODS = ["ping", "status", "spawn", "steer", "stop", "resume"];
const ROLE_AGENTS = {
  mechanical: "pi-minions-mechanical",
  explorer: "pi-minions-explorer",
  implementer: "pi-minions-implementer",
  architect: "pi-minions-architect",
  reviewer: "pi-minions-reviewer",
  planner: "pi-minions-planner",
};
const MINIONS_OPT_OUT = /(?:^|\s)(?:\/direct\b|skip\s+(?:minions|workers)\b|senza\s+minions?\b|non\s+usare\s+minions?\b)/i;
const MINIONS_SKILL_COMMAND = /^\/skill:(pi|paseo|codex)-minions(-lb)?(?=\s|$)/;
const MODEL_ID = /\b(?:gpt|claude|grok)-[a-z0-9][a-z0-9._-]*\b/gi;
const MODEL_REQUEST = /\b(?:use|using|choose|select|force|route|run|spawn|dispatch|prefer|want|usa|usare|utilizza|utilizzare|scegli|scegliere|seleziona|selezionare|forza|forzare|instrada|instradare|preferisco|voglio)\b/i;
const NEGATED_MODEL_REQUEST = /\b(?:do\s+not|don't|never|avoid|non\s+(?:usare|utilizzare|voglio)|senza\s+(?:usare|utilizzare)|evita(?:re)?)\b/i;
const MODEL_REQUEST_BOUNDARIES = [".", "!", "?", ";", "\n"];

function explicitlyRequestedModels(text) {
  if (typeof text !== "string") return new Set();
  const requested = new Set();
  for (const match of text.matchAll(MODEL_ID)) {
    const precedingBoundaries = MODEL_REQUEST_BOUNDARIES
      .map((boundary) => text.lastIndexOf(boundary, match.index - 1));
    const followingBoundaries = MODEL_REQUEST_BOUNDARIES
      .map((boundary) => text.indexOf(boundary, match.index + match[0].length))
      .filter((index) => index >= 0);
    const start = Math.max(...precedingBoundaries) + 1;
    const end = followingBoundaries.length > 0 ? Math.min(...followingBoundaries) : text.length;
    const clause = text.slice(start, end);
    if (!MODEL_REQUEST.test(clause) || NEGATED_MODEL_REQUEST.test(clause)) continue;
    requested.add(match[0].toLowerCase());
  }
  return requested;
}

function slashSkill(text) {
  const match = typeof text === "string" ? text.match(MINIONS_SKILL_COMMAND) : undefined;
  if (!match) return undefined;
  return {
    variant: match[2] ? "lb" : "standard",
    canonicalName: `pi-minions${match[2] ?? ""}`,
    matchedName: match[0].slice("/skill:".length),
  };
}

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
      requiredModels: [
        "claude-opus-5",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
      ],
      routes: {
        mechanical: ["gpt-5.6-luna", "high"],
        explorer: ["claude-opus-5", "high"],
        implementer: ["gpt-5.6-terra", "max"],
        architect: ["claude-opus-5", "xhigh"],
        reviewer: ["gpt-5.6-sol", "high"],
        planner: ["gpt-5.6-terra", "max"],
      },
      overrides: {
        "mechanical-judgment": ["gpt-5.6-terra", "max"],
        "escalate-entry": ["gpt-5.6-sol", "high"],
        "escalate-sol-medium": ["gpt-5.6-sol", "medium"],
        "escalate-sol-high": ["gpt-5.6-sol", "high"],
        "escalate-sol-max": ["gpt-5.6-sol", "max"],
      },
    },
    lb: {
      requiredModels: ["gpt-5.6-luna", "gpt-5.6-sol", "grok-4.5"],
      routes: {
        mechanical: ["gpt-5.6-luna", "high"],
        explorer: ["gpt-5.6-luna", "max"],
        implementer: ["gpt-5.6-luna", "max"],
        architect: ["gpt-5.6-luna", "max"],
        reviewer: ["gpt-5.6-sol", "low"],
        planner: ["gpt-5.6-luna", "max"],
      },
      overrides: {
        "mechanical-judgment": ["gpt-5.6-luna", "max"],
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
  return `${text.slice(0, end)}\n\n[Output truncated for parent context; full output remains in the worker runtime.]`;
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
  const cacheRead = Number(tokens?.cacheRead) || 0;
  const totalTokens = Math.max(Number(tokens?.total) || 0, input + output + cacheRead);
  const costUsd = Number(cost?.costUsd) || 0;
  if (totalTokens === 0 && costUsd === 0) return undefined;
  return {
    input,
    output,
    cacheRead,
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
  return status === "in-flight" || status === "settling" || status === "stopping";
}

function liveUsageFromSnapshot(snapshot) {
  const usage = snapshot?.lastUsage;
  if (!usage) return undefined;
  const input = Number(usage.inputTokens) || 0;
  const cacheRead = Number(usage.cachedInputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const costUsd = Number(usage.totalCostUsd) || 0;
  if (!input && !cacheRead && !output && !costUsd) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + cacheRead + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costUsd },
  };
}

function terminalCandidateSignature(snapshot) {
  return JSON.stringify([
    snapshot?.status,
    snapshot?.lastError,
    snapshot?.updatedAt,
    snapshot?.lastActivityAt,
    snapshot?.lastUsage?.inputTokens,
    snapshot?.lastUsage?.cachedInputTokens,
    snapshot?.lastUsage?.outputTokens,
  ]);
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
  const watchdogIntervalMs = dependencies.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
  const paseoErrorSettleMs = dependencies.paseoErrorSettleMs ?? DEFAULT_PASEO_ERROR_SETTLE_MS;
  const runCostCeilingUsd = dependencies.runCostCeilingUsd ?? DEFAULT_RUN_COST_CEILING_USD;
  const setWatchdogInterval = dependencies.setWatchdogInterval ?? setInterval;
  const clearWatchdogInterval = dependencies.clearWatchdogInterval ?? clearInterval;
  const paseoRuntime = dependencies.paseoRuntime === undefined
    ? createPaseoRuntimeFromProcess(dependencies.paseoOptions)
    : dependencies.paseoRuntime;
  const paseoHosted = dependencies.paseoHosted
    ?? Boolean((dependencies.paseoOptions?.env ?? process.env).PASEO_AGENT_ID?.trim());
  const orcaRuntime = dependencies.orcaRuntime === undefined
    ? createOrcaRuntimeFromProcess(dependencies.orcaOptions)
    : dependencies.orcaRuntime;
  const orcaEnvironment = dependencies.orcaOptions?.env ?? process.env;
  const orcaHosted = dependencies.orcaHosted
    ?? Boolean(
      orcaEnvironment.ORCA_TERMINAL_HANDLE?.trim()
      || orcaEnvironment.ORCA_WORKTREE_ID?.trim()
      || orcaEnvironment.ORCA_AGENT_HOOK_ENDPOINT?.trim(),
    );
  let run;
  let runtimeInfo;
  let changingModel = false;
  let minionsRoutingRequired = false;
  let pendingSlashVariant;
  let pendingModelOverrideAuthorizations = new Set();
  let lastContext;
  let watchdogTimer;
  let watchdogRunning = false;
  const earlyCompletions = new Map();

  function workerSnapshot(worker) {
    return {
      id: worker.id,
      subagentRunId: worker.subagentRunId,
      runtimeAgentId: worker.runtimeAgentId,
      runtimeTerminalId: worker.runtimeTerminalId,
      runtimeTaskId: worker.runtimeTaskId,
      asyncDir: worker.asyncDir,
      role: worker.role,
      agent: worker.agent,
      task: worker.task,
      budgetClass: worker.budgetClass,
      cwd: worker.cwd,
      provider: worker.provider,
      model: worker.model,
      thinking: worker.thinking,
      requestedRouteOverride: worker.requestedRouteOverride,
      routeOverride: worker.routeOverride,
      overrideReason: worker.overrideReason,
      overrideFromWorkerId: worker.overrideFromWorkerId,
      routeOverrideRejection: worker.routeOverrideRejection,
      requestedModelOverride: worker.requestedModelOverride,
      modelOverride: worker.modelOverride,
      modelOverrideRejection: worker.modelOverrideRejection,
      status: worker.status,
      startedAt: worker.startedAt,
      completedAt: worker.completedAt,
      timeoutSeconds: worker.timeoutSeconds,
      timeoutSecondsIgnored: worker.timeoutSecondsIgnored,
      maxCostUsd: worker.maxCostUsd,
      warningCostUsd: worker.warningCostUsd,
      maxDurationSeconds: worker.maxDurationSeconds,
      canonicalCwd: worker.canonicalCwd,
      liveUsage: worker.liveUsage,
      budgetWarningSent: worker.budgetWarningSent,
      budgetStopReason: worker.budgetStopReason,
      terminalCandidate: worker.terminalCandidate,
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
      runtime: run.runtime,
      runtimeRunId: run.runtimeRunId,
      lifecycle,
      originalModel: run.originalModel,
      originalThinking: run.originalThinking,
      nextWorkerNumber: run.nextWorkerNumber,
      launchCount: run.launchCount,
      triagedCount: run.triagedCount,
      runCostCeilingUsd: run.runCostCeilingUsd,
      runBudgetWarningSent: run.runBudgetWarningSent,
      dispatchBlockedReason: run.dispatchBlockedReason,
      modelOverrideAuthorizations: [...run.modelOverrideAuthorizations],
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
    if (latest.runtime !== undefined && !SUPPORTED_RUNTIMES.has(latest.runtime)) return;
    const workers = new Map();
    for (const snapshot of latest.workers ?? []) {
      if (!snapshot?.id || !snapshot?.subagentRunId || !ROLE_AGENTS[snapshot.role]) continue;
      const budget = MODEL_BUDGETS[snapshot.model] ?? MODEL_BUDGETS["gpt-5.6-terra"];
      workers.set(snapshot.id, {
        ...snapshot,
        budgetClass: snapshot.budgetClass === "closure" ? "closure" : "normal",
        maxCostUsd: snapshot.maxCostUsd ?? budget.maxCostUsd,
        warningCostUsd: snapshot.warningCostUsd ?? budget.warningCostUsd,
        maxDurationSeconds: snapshot.maxDurationSeconds ?? budget.maxDurationSeconds,
        canonicalCwd: snapshot.canonicalCwd ?? normalizeGitPath("/", snapshot.cwd),
        observedRunIds: new Set(snapshot.observedRunIds ?? []),
        triagedRunIds: new Set(snapshot.triagedRunIds ?? []),
      });
    }
    run = {
      id: latest.runId,
      provider: latest.provider,
      variant: latest.variant,
      runtime: latest.runtime ?? "pi-subagents",
      runtimeRunId: latest.runtimeRunId,
      originalModel: latest.originalModel,
      originalThinking: latest.originalThinking,
      nextWorkerNumber: latest.nextWorkerNumber ?? Math.max(0, ...[...workers.values()].map((worker) => worker.displayNumber ?? 0)) + 1,
      launchCount: latest.launchCount ?? workers.size,
      triagedCount: latest.triagedCount ?? [...workers.values()]
        .reduce((total, worker) => total + worker.triagedRunIds.size, 0),
      runCostCeilingUsd: latest.runCostCeilingUsd ?? runCostCeilingUsd,
      runBudgetWarningSent: latest.runBudgetWarningSent ?? false,
      dispatchBlockedReason: latest.dispatchBlockedReason,
      modelOverrideAuthorizations: new Set(latest.modelOverrideAuthorizations ?? []),
      workers,
    };
    ctx.ui?.setStatus?.("pi-minions", `${run.provider} · ${run.variant} · recovered`);
    startWatchdog();
  }

  function cleanupListener(event, handler, subscription) {
    if (typeof subscription === "function") subscription();
    else pi.events?.off?.(event, handler);
  }

  function piSubagentsRpcCall(method, params) {
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

  function runtimeKind() {
    if (run?.runtime) return run.runtime;
    if (paseoHosted) return "paseo";
    if (orcaHosted) return "orca";
    if (paseoRuntime) return "paseo";
    if (orcaRuntime) return "orca";
    return "pi-subagents";
  }

  function runtimeCall(method, params) {
    if (runtimeKind() === "paseo") {
      if (!paseoRuntime) {
        return Promise.reject(new Error("This orchestration uses Paseo, but its agent-scoped MCP runtime is unavailable. Install pi-mcp-adapter and reopen the Paseo agent."));
      }
      return paseoRuntime.call(method, params);
    }
    if (runtimeKind() === "orca") {
      if (!orcaRuntime) {
        return Promise.reject(new Error("This orchestration runs inside Orca, but its native CLI identity is incomplete or unavailable. Reopen Pi from a live Orca terminal."));
      }
      return orcaRuntime.call(method, params);
    }
    return piSubagentsRpcCall(method, params);
  }

  async function ensureRuntime() {
    if (runtimeInfo) return runtimeInfo;
    const info = await runtimeCall("ping", { runId: run?.runtimeRunId });
    if (runtimeKind() === "paseo" || runtimeKind() === "orca") {
      if (info?.runtime !== runtimeKind()) throw new Error(`Incompatible ${runtimeKind()} Minions runtime.`);
      runtimeInfo = info;
      return info;
    }
    const methods = new Set(info?.methods ?? []);
    const missing = REQUIRED_RPC_METHODS.filter((method) => !methods.has(method));
    if (info?.version !== SUBAGENTS_RPC_VERSION || missing.length > 0 || info?.capabilities?.asyncSpawn !== true) {
      throw new Error(`Incompatible pi-subagents RPC runtime${missing.length ? `; missing: ${missing.join(", ")}` : ""}. Install npm:pi-subagents@0.37.2.`);
    }
    if (
      info?.capabilities?.nonRecoveringSteer !== true
      || info?.capabilities?.processTerminalProof?.version !== 1
      || info?.capabilities?.processTerminalProof?.lifecycleArtifactVersion !== 3
    ) {
      throw new Error("Incompatible pi-subagents runtime: Minions requires non-recovering steering and lifecycle artifact v3.");
    }
    if (info?.events?.asyncComplete !== SUBAGENTS_ASYNC_COMPLETE) {
      throw new Error("Incompatible pi-subagents completion event contract.");
    }
    runtimeInfo = info;
    return info;
  }

  function escalationEvidenceMatches(worker, reason) {
    const evidence = [worker.status, worker.output, worker.error, worker.progress]
      .filter(Boolean)
      .join("\n");
    if (reason === "worker-failure") return worker.status === "failed";
    if (reason === "verification-failure") {
      return /(?:verify|verification|test|lint|build|gate)[^\n]{0,120}(?:fail|blocked)|(?:fail|blocked)[^\n]{0,120}(?:verify|verification|test|lint|build|gate)/i.test(evidence);
    }
    if (reason === "blocked") return worker.status === "failed" || /STATUS:\s*BLOCKED\b/i.test(evidence);
    if (reason === "review-changes-required") return /STATUS:\s*REVIEW_CHANGES_REQUIRED\b/i.test(evidence);
    if (reason === "mediocre-result") return /STATUS:\s*DONE_WITH_CONCERNS\b/i.test(evidence);
    return false;
  }

  function routeOverrideRejection(spec) {
    const override = spec.routeOverride;
    if (!override) {
      return spec.overrideReason || spec.overrideFromWorkerId
        ? "override evidence was supplied without routeOverride"
        : undefined;
    }
    if (override === "mechanical-judgment") {
      if (spec.role !== "mechanical") return "mechanical-judgment is valid only for the mechanical role";
      if (!MECHANICAL_JUDGMENT_REASONS.has(spec.overrideReason)) {
        return "mechanical-judgment requires overrideReason merge-conflict or github-judgment";
      }
      if (spec.overrideFromWorkerId) return "mechanical-judgment must not set overrideFromWorkerId";
      return undefined;
    }
    if (!override.startsWith("escalate-")) return `unknown route override ${override}`;
    if (!ESCALATION_REASONS.has(spec.overrideReason)) {
      return `${override} requires a failure-class overrideReason`;
    }
    if (!spec.overrideFromWorkerId) {
      return `${override} requires overrideFromWorkerId referencing the prior adverse result`;
    }
    const worker = run.workers.get(spec.overrideFromWorkerId);
    if (!worker) return `escalation evidence worker not found: ${spec.overrideFromWorkerId}`;
    if (activeStatus(worker.status)) return `escalation evidence worker ${worker.id} is still ${worker.status}`;
    if ((worker.triagedRunIds?.size ?? 0) === 0) {
      return `escalation evidence worker ${worker.id} has not been triaged`;
    }
    if (!escalationEvidenceMatches(worker, spec.overrideReason)) {
      return `worker ${worker.id} does not contain ${spec.overrideReason} evidence for ${override}`;
    }
    return undefined;
  }

  function resolveWorkerRoute(spec, ctx) {
    const matrix = PROVIDER_MATRICES[run.provider]?.[run.variant];
    const roleRoute = matrix?.routes[spec.role];
    if (!roleRoute) throw new Error(`Unknown worker role: ${spec.role}`);
    let rejection = routeOverrideRejection(spec);
    let appliedRouteOverride = rejection ? undefined : spec.routeOverride;
    if (appliedRouteOverride && !matrix.overrides[appliedRouteOverride]) {
      rejection = `route override ${appliedRouteOverride} is unavailable for ${run.variant}`;
      appliedRouteOverride = undefined;
    }
    const budgetClass = spec.budgetClass ?? "normal";
    if (!BUDGET_CLASSES.has(budgetClass)) throw new Error(`Unknown worker budget class: ${budgetClass}`);
    if (budgetClass === "closure" && !CLOSURE_ROLES.has(spec.role)) {
      throw new Error(`The closure budget class is unavailable for role ${spec.role}.`);
    }
    const route = appliedRouteOverride ? matrix.overrides[appliedRouteOverride] : roleRoute;
    const [defaultModel, thinking] = route;
    const requestedModelOverride = typeof spec.modelOverride === "string" ? spec.modelOverride.trim() : "";
    const modelOverrideRejection = requestedModelOverride
      && !run.modelOverrideAuthorizations.has(requestedModelOverride.toLowerCase())
      ? `model override ${requestedModelOverride} was not explicitly requested by the user for this batch`
      : undefined;
    const modelOverride = requestedModelOverride && !modelOverrideRejection
      ? requestedModelOverride
      : undefined;
    const modelId = modelOverride || defaultModel;
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
    const budget = MODEL_BUDGETS[modelId] ?? MODEL_BUDGETS["gpt-5.6-terra"];
    const maxDurationSeconds = spec.maxDurationSeconds ?? budget.maxDurationSeconds;
    const timeoutSecondsIgnored = run.runtime !== "pi-subagents" && spec.timeoutSeconds !== undefined;
    return {
      modelId,
      thinking,
      cwd,
      canonicalCwd: normalizeGitPath("/", cwd),
      maxCostUsd: spec.maxCostUsd ?? budget.maxCostUsd,
      warningCostUsd: spec.maxCostUsd === undefined
        ? budget.warningCostUsd
        : Math.round(spec.maxCostUsd * 0.67 * 100) / 100,
      maxDurationSeconds,
      timeoutSecondsIgnored,
      agent: ROLE_AGENTS[spec.role],
      budgetClass,
      requestedRouteOverride: spec.routeOverride,
      routeOverride: appliedRouteOverride,
      routeOverrideRejection: rejection,
      requestedModelOverride: requestedModelOverride || undefined,
      modelOverride,
      modelOverrideRejection,
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
      ...(spec.timeoutSeconds && run.runtime === "pi-subagents" ? { timeoutMs: spec.timeoutSeconds * 1_000 } : {}),
      ...(route.disciplineLoaded ? { skill: route.discipline } : {}),
      control: {
        enabled: true,
        notifyOn: ["active_long_running", "needs_attention"],
        notifyChannels: ["event"],
      },
    };
  }

  function registerSpawnedWorker(data, task, route, ctx) {
    const worker = {
      id: idFactory(),
      subagentRunId: data.details.asyncId,
      runtimeAgentId: data.details.runtimeAgentId,
      runtimeTerminalId: data.details.runtimeTerminalId,
      runtimeTaskId: data.details.runtimeTaskId,
      asyncDir: data.details.asyncDir,
      role: task.role,
      agent: route.agent,
      task: task.task,
      budgetClass: route.budgetClass,
      cwd: route.cwd,
      provider: run.provider,
      model: route.modelId,
      thinking: route.thinking,
      requestedRouteOverride: route.requestedRouteOverride,
      routeOverride: route.routeOverride,
      overrideReason: route.routeOverride ? task.overrideReason : undefined,
      overrideFromWorkerId: route.routeOverride ? task.overrideFromWorkerId : undefined,
      routeOverrideRejection: route.routeOverrideRejection,
      requestedModelOverride: route.requestedModelOverride,
      modelOverride: route.modelOverride,
      modelOverrideRejection: route.modelOverrideRejection,
      displayNumber: run.nextWorkerNumber++,
      status: "in-flight",
      startedAt: now(),
      timeoutSeconds: task.timeoutSeconds,
      timeoutSecondsIgnored: route.timeoutSecondsIgnored,
      maxCostUsd: route.maxCostUsd,
      warningCostUsd: route.warningCostUsd,
      maxDurationSeconds: route.maxDurationSeconds,
      canonicalCwd: route.canonicalCwd,
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
  }

  function enforceWriterLeases(tasks, routes) {
    const occupied = new Map();
    for (const worker of run.workers.values()) {
      if (!WRITER_ROLES.has(worker.role) || !activeStatus(worker.status)) continue;
      occupied.set(worker.canonicalCwd ?? normalizeGitPath("/", worker.cwd), worker);
    }
    for (let index = 0; index < tasks.length; index += 1) {
      if (!WRITER_ROLES.has(tasks[index].role)) continue;
      const canonical = routes[index].canonicalCwd;
      const holder = occupied.get(canonical);
      if (holder) {
        throw new Error(`Writer worktree is leased by ${holder.role} worker ${holder.id} in status ${holder.status}: ${routes[index].cwd}`);
      }
      occupied.set(canonical, { id: "this spawn batch", role: tasks[index].role, status: "pending" });
    }
  }

  function enforceTriageBudget(budgetClasses) {
    if (run.triagedCount >= MAX_TRIAGED_RESULTS) {
      throw new Error(`Pi minions reached its hard ${MAX_TRIAGED_RESULTS}-result triage limit; close and start a new orchestration run.`);
    }
    if (run.triagedCount >= SOFT_TRIAGED_RESULTS && budgetClasses.some((budgetClass) => budgetClass !== "closure")) {
      throw new Error(`Pi minions reached its soft ${SOFT_TRIAGED_RESULTS}-result triage limit; only budgetClass closure work may continue.`);
    }
  }

  function findWorkerBySubagentRunId(subagentRunId) {
    if (!run || !subagentRunId) return undefined;
    return [...run.workers.values()].find((worker) => worker.subagentRunId === subagentRunId);
  }

  function runtimeTarget(worker) {
    return {
      id: worker.runtimeAgentId ?? worker.subagentRunId,
      ...(run.runtime === "paseo" ? { runId: worker.subagentRunId } : {}),
      ...(run.runtime === "orca" ? {
        runId: worker.subagentRunId,
        terminalId: worker.runtimeTerminalId,
        taskId: worker.runtimeTaskId,
      } : {}),
    };
  }

  function applyCompletion(worker, payload, ctx, { notify = false } = {}) {
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
    if (notify && firstObservation && run.runtime === "orca") {
      pi.sendMessage?.({
        customType: "pi-minions-orca-complete",
        content: `Orca Minions worker ${worker.id} (${worker.role}) reached ${worker.status}. Call minions_read, update the board, and dispatch newly unblocked work.`,
        display: true,
        details: { workerId: worker.id, role: worker.role, status: worker.status },
      }, { triggerTurn: true, deliverAs: "followUp" });
    }
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

  async function refreshWorker(worker, ctx, { includeActivity = true, notifyCompletion = false } = {}) {
    if (!activeStatus(worker.status)) return;
    const data = await runtimeCall("status", {
      ...runtimeTarget(worker),
      requestedStop: worker.status === "stopping",
      includeActivity,
    });
    const text = typeof data?.text === "string" ? data.text : "";
    const parsed = parseStatusText(text);
    const snapshot = data?.details?.snapshot;
    worker.liveUsage = liveUsageFromSnapshot(snapshot) ?? worker.liveUsage;
    worker.progress = text;

    if (run.runtime === "paseo" && ["running", "initializing"].includes(snapshot?.status)) {
      worker.terminalCandidate = undefined;
      if (worker.status !== "stopping") worker.status = "in-flight";
      return;
    }

    if (data?.details?.completion) {
      const completion = data.details.completion;
      const failedPaseoObservation = run.runtime === "paseo"
        && completionStatus(completion) === "blocked"
        && worker.status !== "stopping";
      if (failedPaseoObservation) {
        const signature = terminalCandidateSignature(snapshot);
        if (worker.terminalCandidate?.signature !== signature) {
          worker.terminalCandidate = { signature, firstSeenAt: now(), completion };
          worker.status = "settling";
          worker.error = completionError(completion);
          worker.progress = `${text}\n\nPaseo failure is provisional for ${Math.ceil(paseoErrorSettleMs / 1000)}s; the worktree lease remains held while automatic retry/compaction settles.`;
          return;
        }
        if (now() - worker.terminalCandidate.firstSeenAt < paseoErrorSettleMs) {
          worker.status = "settling";
          return;
        }
      }
      worker.terminalCandidate = undefined;
      applyCompletion(worker, completion, ctx, { notify: notifyCompletion });
      return;
    }
    if (["complete", "completed", "failed", "stopped", "paused"].includes(parsed.state)) {
      const lifecycle = readLifecycle(worker);
      const summary = lifecycle?.summary || parsed.output;
      applyCompletion(worker, {
        ...(lifecycle ?? {}),
        runId: worker.subagentRunId,
        state: lifecycle?.state ?? parsed.state,
        ...(summary ? { summary } : {}),
        ...(lifecycle?.error || parsed.error ? { error: lifecycle?.error ?? parsed.error } : {}),
      }, ctx, { notify: notifyCompletion });
      if (worker.status === "blocked" && !worker.error) {
        worker.error = `${run.runtime} reported a failed run.`;
      }
    }
  }

  function observedWorkerCost(worker) {
    return Math.max(
      Number(worker.liveUsage?.cost?.total) || 0,
      Number(worker.usage?.cost?.total) || 0,
    );
  }

  function observedRunCost() {
    if (!run) return 0;
    return [...run.workers.values()].reduce((total, worker) => total + observedWorkerCost(worker), 0);
  }

  async function enforceWorkerBudget(worker, ctx) {
    if (!activeStatus(worker.status) || worker.status === "stopping") return;
    const cost = observedWorkerCost(worker);
    const elapsedSeconds = Math.max(0, (now() - worker.startedAt) / 1000);
    if (!worker.budgetWarningSent && cost >= worker.warningCostUsd) {
      worker.budgetWarningSent = true;
      ctx?.ui?.notify?.(
        `Minions ${worker.role} ${worker.id} reached $${cost.toFixed(2)} of its $${worker.maxCostUsd.toFixed(2)} cost ceiling.`,
        "warning",
      );
    }
    let reason;
    if (cost >= worker.maxCostUsd) {
      reason = `model-aware cost ceiling reached ($${cost.toFixed(2)} >= $${worker.maxCostUsd.toFixed(2)})`;
    } else if (elapsedSeconds >= worker.maxDurationSeconds) {
      reason = `model-aware duration ceiling reached (${Math.floor(elapsedSeconds)}s >= ${worker.maxDurationSeconds}s)`;
    }
    if (!reason) return;
    const stopped = await runtimeCall("stop", runtimeTarget(worker));
    if (stopped?.state === "running") {
      throw new Error(`Watchdog stop was rejected for worker ${worker.id}.`);
    }
    worker.status = "stopping";
    worker.budgetStopReason = reason;
    worker.progress = `Watchdog stop requested: ${reason}. Worktree lease remains held until terminal confirmation.`;
    ctx?.ui?.notify?.(`Minions watchdog stopped ${worker.role} ${worker.id}: ${reason}.`, "error");
  }

  async function watchdogTick() {
    if (watchdogRunning || !run || !["paseo", "orca"].includes(run.runtime) || !lastContext) return;
    watchdogRunning = true;
    try {
      await ensureRuntime();
      const active = [...run.workers.values()].filter((worker) => activeStatus(worker.status));
      for (const worker of active) {
        try {
          await refreshWorker(worker, lastContext, { includeActivity: false, notifyCompletion: true });
          await enforceWorkerBudget(worker, lastContext);
        } catch (error) {
          worker.progress = `Watchdog status refresh unavailable: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      const runCost = observedRunCost();
      const ceiling = run.runCostCeilingUsd ?? runCostCeilingUsd;
      if (!run.runBudgetWarningSent && runCost >= ceiling * 0.75) {
        run.runBudgetWarningSent = true;
        lastContext.ui?.notify?.(`Minions run reached $${runCost.toFixed(2)} of its $${ceiling.toFixed(2)} cost ceiling.`, "warning");
      }
      if (runCost >= ceiling && !run.dispatchBlockedReason) {
        run.dispatchBlockedReason = `Minions run reached its $${ceiling.toFixed(2)} cost ceiling ($${runCost.toFixed(2)} observed); no new workers may be dispatched.`;
        lastContext.ui?.notify?.(run.dispatchBlockedReason, "error");
      }
      persistRun();
    } finally {
      watchdogRunning = false;
    }
  }

  function startWatchdog() {
    if (watchdogTimer !== undefined || !run || !["paseo", "orca"].includes(run.runtime)) return;
    watchdogTimer = setWatchdogInterval(() => {
      void watchdogTick();
    }, watchdogIntervalMs);
    watchdogTimer?.unref?.();
  }

  function stopWatchdog() {
    if (watchdogTimer === undefined) return;
    clearWatchdogInterval(watchdogTimer);
    watchdogTimer = undefined;
  }

  pi.registerCommand("minions", {
    description: "Explicitly start Minions orchestration in the current workspace",
    handler: async (args) => {
      pendingSlashVariant = "standard";
      pendingModelOverrideAuthorizations = explicitlyRequestedModels(args);
      minionsRoutingRequired = true;
      const suffix = args.trim();
      pi.sendUserMessage(`/skill:pi-minions${suffix ? ` ${suffix}` : ""}`);
    },
  });

  pi.registerCommand("minions-lb", {
    description: "Explicitly start low-budget Minions orchestration in the current workspace",
    handler: async (args) => {
      pendingSlashVariant = "lb";
      pendingModelOverrideAuthorizations = explicitlyRequestedModels(args);
      minionsRoutingRequired = true;
      const suffix = args.trim();
      pi.sendUserMessage(`/skill:pi-minions-lb${suffix ? ` ${suffix}` : ""}`);
    },
  });

  pi.registerTool({
    name: "minions_start",
    label: "Start Minions",
    description: "Start one provider-affine Pi orchestration run after explicit /minions or /minions-lb activation.",
    parameters: schemas.start ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      const variant = params.variant ?? "standard";
      if (!SUPPORTED_VARIANTS.has(variant)) throw new Error(`Unknown minions variant: ${variant}`);
      if (!run && pendingSlashVariant !== variant) {
        throw new Error(`Minions is slash-command-only. The user must explicitly invoke /${variant === "lb" ? "minions-lb" : "minions"} before minions_start.`);
      }
      minionsRoutingRequired = true;
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
      const selectedRuntime = runtimeKind();
      const selectedRuntimeInfo = await ensureRuntime();

      const frontier = ctx.modelRegistry.find(provider, "gpt-5.6-sol");
      const originalModel = ctx.model;
      const originalThinking = pi.getThinkingLevel();
      if (!(await pi.setModel(frontier))) throw new Error(`Unable to select ${provider}/gpt-5.6-sol.`);
      pi.setThinkingLevel("medium");
      pendingSlashVariant = undefined;
      run = {
        id: idFactory(),
        provider,
        variant,
        runtime: selectedRuntime,
        runtimeRunId: selectedRuntimeInfo?.runId,
        originalModel,
        originalThinking,
        workers: new Map(),
        nextWorkerNumber: 1,
        launchCount: 0,
        triagedCount: 0,
        runCostCeilingUsd: params.maxRunCostUsd ?? runCostCeilingUsd,
        runBudgetWarningSent: false,
        modelOverrideAuthorizations: new Set(pendingModelOverrideAuthorizations),
      };
      pendingModelOverrideAuthorizations = new Set();
      ctx.ui?.setStatus?.("pi-minions", `${provider} · ${variant}`);
      persistRun();
      startWatchdog();
      const runtimeLabel = selectedRuntime === "paseo"
        ? "Paseo native agents"
        : selectedRuntime === "orca"
          ? "Orca native orchestration"
          : "pi-subagents RPC v1";
      return textResult(`Started ${variant} orchestration with Provider Affinity ${provider} on ${runtimeLabel}.`, {
        runId: run.id,
        provider,
        variant,
        frontier: "gpt-5.6-sol",
        thinking: "medium",
        runtime: selectedRuntime,
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
      enforceTriageBudget(tasks.map((task) => task.budgetClass ?? "normal"));
      if (run.launchCount + tasks.length > MAX_WORKER_LAUNCHES) {
        throw new Error(`Pi minions allows at most ${MAX_WORKER_LAUNCHES} worker launches per orchestration run.`);
      }
      if (run.dispatchBlockedReason) throw new Error(run.dispatchBlockedReason);
      const routes = tasks.map((task) => resolveWorkerRoute(task, ctx));
      enforceWriterLeases(tasks, routes);
      if (run.modelOverrideAuthorizations.size > 0) {
        run.modelOverrideAuthorizations.clear();
        persistRun();
      }
      const settled = await Promise.allSettled(tasks.map((task, index) => runtimeCall("spawn", spawnParams(task, routes[index]))));
      const launched = settled
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === "fulfilled" && result.value?.details?.asyncId);
      const failure = settled.find((result) => result.status === "rejected" || !result.value?.details?.asyncId);
      if (failure) {
        const workers = launched.map(({ result, index }) => registerSpawnedWorker(result.value, tasks[index], routes[index], ctx));
        run.launchCount += workers.length;
        for (const worker of workers) {
          if (activeStatus(worker.status)) {
            worker.status = "stopping";
            worker.progress = `Stop requested; waiting for ${run.runtime} terminal confirmation.`;
          }
        }
        persistRun();
        await Promise.allSettled(workers.map((worker) => runtimeCall("stop", runtimeTarget(worker))));
        persistRun();
        const reason = failure.status === "rejected"
          ? failure.reason
          : new Error(`${run.runtime} spawn reply did not include a worker run id.`);
        throw reason;
      }

      const workers = launched.map(({ result, index }) => registerSpawnedWorker(result.value, tasks[index], routes[index], ctx));
      run.launchCount += workers.length;
      persistRun();
      const rejectedRouteOverrides = workers.filter((worker) => worker.routeOverrideRejection);
      const routeOverrideNotice = rejectedRouteOverrides.length > 0
        ? ` Ignored ${rejectedRouteOverrides.length} invalid route override(s) and used the normal role matrix: ${rejectedRouteOverrides.map((worker) => `${worker.role} ${worker.id}: ${worker.routeOverrideRejection}`).join("; ")}.`
        : "";
      const rejectedModelOverrides = workers.filter((worker) => worker.modelOverrideRejection);
      const modelOverrideNotice = rejectedModelOverrides.length > 0
        ? ` Ignored ${rejectedModelOverrides.length} invalid model override(s) and used the normal role matrix: ${rejectedModelOverrides.map((worker) => `${worker.role} ${worker.id}: ${worker.modelOverrideRejection}`).join("; ")}.`
        : "";
      const ignoredTimeouts = workers.filter((worker) => worker.timeoutSecondsIgnored);
      const timeoutNotice = ignoredTimeouts.length > 0
        ? ` Ignored timeoutSeconds for ${ignoredTimeouts.length} ${run.runtime === "paseo" ? "Paseo" : "Orca"} worker(s); their model-aware maxDurationSeconds watchdog remains ${ignoredTimeouts.map((worker) => `${worker.id}=${worker.maxDurationSeconds}s`).join(", ")}. Do not retry with timeoutSeconds.`
        : "";
      return textResult(
        `Spawned ${workers.length} persistent worker(s): ${workers.map((worker) => `${worker.role} ${worker.id}`).join(", ")}.${routeOverrideNotice}${modelOverrideNotice}${timeoutNotice} End this turn now; do not poll. ${run.runtime === "paseo" ? "Paseo" : run.runtime === "orca" ? "Orca" : "pi-subagents"} will notify this session on completion.`,
        { workers: workers.map(workerSnapshot) },
      );
    },
  });

  pi.registerTool({
    name: "minions_read",
    label: "Read Minions",
    description: "Read status and final output from managed Minions workers.",
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
            await enforceWorkerBudget(worker, ctx);
          } catch (error) {
            worker.progress = `Status refresh unavailable: ${error instanceof Error ? error.message : String(error)}`;
          }
        }));
        const runCost = observedRunCost();
        const ceiling = run.runCostCeilingUsd ?? runCostCeilingUsd;
        if (!run.runBudgetWarningSent && runCost >= ceiling * 0.75) {
          run.runBudgetWarningSent = true;
          ctx.ui?.notify?.(`Minions run reached $${runCost.toFixed(2)} of its $${ceiling.toFixed(2)} cost ceiling.`, "warning");
        }
        if (runCost >= ceiling && !run.dispatchBlockedReason) {
          run.dispatchBlockedReason = `Minions run reached its $${ceiling.toFixed(2)} cost ceiling ($${runCost.toFixed(2)} observed); no new workers may be dispatched.`;
        }
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
        const body = worker.status === "settling"
          ? (worker.progress || worker.error || "Paseo terminal state is still settling.")
          : (worker.error || worker.output || worker.progress || "(no output yet)");
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
    description: "Send acknowledged guidance to a live managed worker.",
    parameters: schemas.steer ?? {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      lastContext = ctx;
      if (!run) throw new Error("No orchestration run is active.");
      const worker = run.workers.get(params.workerId);
      if (!worker) throw new Error(`Unknown worker: ${params.workerId}`);
      if (worker.status !== "in-flight") throw new Error(`Worker ${params.workerId} is not in flight.`);
      await ensureRuntime();
      const data = await runtimeCall("steer", { ...runtimeTarget(worker), message: params.message });
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
      const inFlight = [...run.workers.values()].filter((candidate) => activeStatus(candidate.status)).length;
      if (inFlight >= MAX_IN_FLIGHT) throw new Error(`Pi minions allows at most ${MAX_IN_FLIGHT} in-flight workers.`);
      enforceTriageBudget([worker.budgetClass]);
      if (run.launchCount >= MAX_WORKER_LAUNCHES) {
        throw new Error(`Pi minions reached its ${MAX_WORKER_LAUNCHES}-launch worker budget.`);
      }
      await ensureRuntime();
      const data = await runtimeCall("resume", {
        ...runtimeTarget(worker),
        message: params.message,
        ...(run.runtime === "orca" ? {
          agent: worker.agent,
          task: worker.task,
          cwd: worker.cwd,
          model: `${run.provider}/${worker.model}:${worker.thinking}`,
        } : {}),
      });
      const resumedId = data?.details?.asyncId;
      if (!resumedId) throw new Error(`${run.runtime} resume reply did not include a worker run id.`);
      worker.subagentRunId = resumedId;
      worker.runtimeAgentId = data.details.runtimeAgentId ?? worker.runtimeAgentId;
      worker.runtimeTerminalId = data.details.runtimeTerminalId ?? worker.runtimeTerminalId;
      worker.runtimeTaskId = data.details.runtimeTaskId ?? worker.runtimeTaskId;
      worker.asyncDir = data.details.asyncDir;
      worker.status = "in-flight";
      worker.startedAt = now();
      worker.completedAt = undefined;
      worker.output = "";
      worker.progress = "";
      worker.error = undefined;
      worker.liveUsage = undefined;
      worker.budgetWarningSent = false;
      worker.budgetStopReason = undefined;
      worker.terminalCandidate = undefined;
      run.launchCount += 1;
      const early = earlyCompletions.get(resumedId);
      if (early) {
        earlyCompletions.delete(resumedId);
        applyCompletion(worker, early, ctx);
      }
      persistRun();
      return textResult(`Resumed worker ${worker.id} as ${run.runtime} run ${resumedId}. End this turn and wait for its completion notification.`, {
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
        const settled = await Promise.allSettled(active.map((worker) => runtimeCall("stop", runtimeTarget(worker))));
        const failed = settled.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        for (const worker of active) {
          if (activeStatus(worker.status)) {
            worker.status = "stopping";
            worker.progress = `Stop requested; waiting for ${run.runtime} terminal confirmation.`;
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
      if (closing.runtime === "orca") {
        await ensureRuntime();
        const releases = await Promise.allSettled([...closing.workers.values()].map((worker) => runtimeCall("release", runtimeTarget(worker))));
        const failedRelease = releases.find((result) => result.status === "rejected");
        if (failedRelease) throw failedRelease.reason;
      }
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
      stopWatchdog();
      pendingSlashVariant = undefined;
      pendingModelOverrideAuthorizations = new Set();
      minionsRoutingRequired = false;
      ctx.ui?.setStatus?.("pi-minions", undefined);
      const residualLabel = closing.runtime === "paseo"
        ? "Paseo agents remain available"
        : closing.runtime === "orca"
          ? "Orca worker output archives remain available"
          : "pi-subagents artifacts and resumable sessions remain available";
      const result = textResult(`Closed orchestration ${closing.id} and restored the original model. ${residualLabel}.`, {
        runId: closing.id,
      });
      if (pendingUsage) result.usage = pendingUsage;
      return result;
    },
  });

  pi.on("input", (event) => {
    if (event.source === "extension") return { action: "continue" };
    if (MINIONS_OPT_OUT.test(event.text)) {
      pendingSlashVariant = undefined;
      pendingModelOverrideAuthorizations = new Set();
      minionsRoutingRequired = Boolean(run);
      return { action: "continue" };
    }
    const requestedModels = explicitlyRequestedModels(event.text);
    if (run && requestedModels.size > 0) {
      for (const modelId of requestedModels) run.modelOverrideAuthorizations.add(modelId);
      persistRun();
    }
    const skill = slashSkill(event.text);
    if (skill) {
      pendingSlashVariant = skill.variant;
      pendingModelOverrideAuthorizations = requestedModels;
      minionsRoutingRequired = true;
      if (skill.matchedName !== skill.canonicalName) {
        return {
          action: "transform",
          text: event.text.replace(`/skill:${skill.matchedName}`, `/skill:${skill.canonicalName}`),
        };
      }
      return { action: "continue" };
    }
    if (!run) {
      pendingSlashVariant = undefined;
      pendingModelOverrideAuthorizations = new Set();
      minionsRoutingRequired = false;
    }
    return { action: "continue" };
  });

  pi.on("tool_call", (event) => {
    if (!run && !minionsRoutingRequired) return;
    if (event.toolName === "mcp") {
      const paseoTool = event.input?.tool ?? event.input?.describe;
      if (!["paseo_create_workspace", "paseo_create_agent", "paseo_send_agent_prompt"].includes(paseoTool)) return;
      return {
        block: true,
        reason: `${paseoTool} bypasses Minions. Use minions_spawn so native child agents remain in the current Paseo Workspace.`,
      };
    }
    if (event.toolName === "bash" && runtimeKind() === "orca") {
      const command = event.input?.command;
      const mutatesWorkerLifecycle = typeof command === "string" && /\b(?:orca|orca-dev|orca-ide)(?:\.exe)?\s+(?:orchestration\s+(?:run-create|run-use|task-create|task-update|dispatch|worker-start|worker-stop|worker-abandon|worker-release|worker-retain|send|reply)|terminal\s+(?:create|send|stop|close|split))\b/i.test(command);
      if (mutatesWorkerLifecycle) {
        return {
          block: true,
          reason: "Direct Orca worker lifecycle commands bypass Minions. Use the corresponding minions_* tool.",
        };
      }
    }
  });

  pi.on("before_agent_start", (event, ctx) => {
    lastContext = ctx;
    return {
      systemPrompt: `${event.systemPrompt}

Minions is strictly slash-command-only. Never infer, select, or start Minions from a natural-language request, even when the user mentions Minions, orchestration, parallel agents, or workers. Only an explicit /minions, /minions-lb, or corresponding /skill:pi-minions slash invocation authorizes minions_start; without one, perform ordinary single-agent work and never call any minions_* tool. During an authorized Minions run, call minions_start first and use only minions_* tools for orchestration. Minions owns provider affinity, role routing, budgets, board identity, and worker lifecycle. Normal minions_spawn calls must omit modelOverride; the runtime accepts it only when the raw user input explicitly requested that exact model for the next batch. In Paseo, never call MCP create_workspace and never create another Paseo Workspace for Minions. Do not call generic MCP create_agent, send_agent_prompt, or the generic subagent tool for top-level dispatch. minions_spawn creates native child agents in the caller's existing Paseo workspace. In Orca-hosted Pi, minions_spawn creates native supervised Orca Tasks and Dispatches in background Pi terminals; never bypass it with direct Orca terminal, Task, Dispatch, or worker lifecycle commands. Orca writer cwd paths must be Orca-managed worktrees prepared through the Orca worktree-create command; ordinary Pi uses linked Git worktrees. You may use subagent_supervisor only to answer a managed pi-subagents worker request. After minions_spawn or minions_resume, end the turn immediately. A Paseo, Orca, or pi-subagents completion notification means you must call minions_read, update the board, and dispatch newly unblocked work.`,
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
    stopWatchdog();
    if (run) persistRun();
    if (event.reason === "reload") disposeCompletionListener();
  });
}
