import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ORCA_CAPABILITY = "orchestration.contract.v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const ROLE_PROMPT_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "agents");
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function trim(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function discoverOrcaHost({ env = process.env, platform = process.platform } = {}) {
  const terminalHandle = trim(env.ORCA_TERMINAL_HANDLE);
  const worktreeId = trim(env.ORCA_WORKTREE_ID);
  const hookEndpoint = trim(env.ORCA_AGENT_HOOK_ENDPOINT);
  const hookVersion = trim(env.ORCA_AGENT_HOOK_VERSION);
  if (!terminalHandle || !worktreeId || !hookEndpoint || hookVersion !== "1") return undefined;

  const command = trim(env.ORCA_CLI_COMMAND)
    ?? (trim(env.ORCA_DEV_REPO_ROOT) ? "orca-dev" : platform === "linux" ? "orca-ide" : "orca");
  return { command, terminalHandle, worktreeId, hookEndpoint, hookVersion };
}

function parseCliPayload(stdout, stderr, args) {
  let payload;
  try {
    payload = JSON.parse(String(stdout ?? "").trim());
  } catch (error) {
    const detail = String(stderr ?? "").trim();
    throw new Error(`Orca CLI returned invalid JSON for ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ""}`);
  }
  if (payload?.ok === false) {
    const code = payload.error?.code ? ` (${payload.error.code})` : "";
    const next = payload.error?.data?.nextSteps;
    const guidance = Array.isArray(next) && next.length > 0 ? `\n${next.join("\n")}` : "";
    throw new Error(`Orca CLI failed${code}: ${payload.error?.message ?? "unknown error"}${guidance}`);
  }
  if (payload?.ok !== true || payload.result === undefined) {
    throw new Error(`Orca CLI returned no result for ${args.join(" ")}.`);
  }
  return payload.result;
}

export function createOrcaCliCaller(host, {
  execFileImpl = execFile,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!host?.command) throw new Error("Orca runtime requires a resolved CLI command.");
  return async function callOrca(args, { timeoutMs = requestTimeoutMs } = {}) {
    const cliArgs = [...args, "--json"];
    return await new Promise((resolve, reject) => {
      execFileImpl(host.command, cliArgs, {
        encoding: "utf8",
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        try {
          const result = parseCliPayload(stdout, stderr, cliArgs);
          // Some Orca lifecycle commands intentionally exit non-zero while still
          // returning an authoritative structured state such as stop_unknown.
          resolve(result);
        } catch (parseError) {
          if (String(stdout ?? "").trim()) {
            reject(parseError);
          } else if (error) {
            const detail = String(stderr ?? "").trim();
            reject(new Error(`Unable to run ${host.command} ${cliArgs.join(" ")}: ${error.message}${detail ? `\n${detail}` : ""}`));
          } else {
            reject(parseError);
          }
        }
      });
    });
  };
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return markdown.trim();
  const end = markdown.indexOf("\n---", 3);
  return end < 0 ? markdown.trim() : markdown.slice(end + 4).trim();
}

function defaultReadRolePrompt(agent) {
  if (!/^pi-minions-[a-z-]+$/.test(agent)) throw new Error(`Invalid Orca worker agent: ${agent}`);
  return stripFrontmatter(fs.readFileSync(path.join(ROLE_PROMPT_DIRECTORY, `${agent}.md`), "utf8"));
}

function roleFromAgent(agent) {
  return agent.replace(/^pi-minions-/, "");
}

function buildWorkerPrompt(params, readRolePrompt, { resumed = false } = {}) {
  const role = roleFromAgent(params.agent);
  const reviewerGuidance = role === "reviewer"
    ? "Perform the Standards and Spec axes yourself and report them separately. Orca workers must not use generic subagents for the review axes."
    : "Do not create or delegate to additional agents.";
  const mechanicalGuidance = role === "mechanical"
    ? "Only when the assignment explicitly asks you to prepare write isolation, you may use `orca worktree create/show/set`; do not create or control agent terminals or orchestration Runs, Tasks, or Dispatches."
    : "Do not call Orca worktree, terminal, or orchestration control commands except the ask/worker_done commands required by Orca's injected dispatch preamble.";
  const assignment = resumed
    ? `Continue the same bounded assignment with this follow-up:\n\n${params.message}`
    : params.task;
  return `You are an Orca-managed Minions ${role} worker. Complete only this bounded assignment.\n\n${readRolePrompt(params.agent)}\n\n## Orca runtime constraints\n\n${reviewerGuidance}\n${mechanicalGuidance}\nNever inspect, prompt, steer, stop, or resume sibling workers. Worker lifecycle belongs exclusively to the Minions frontier.\nDo not call minions_start or any minions_* tool. Never interview the user and do not call Orca ask; if a human decision is required, return STATUS: NEEDS_USER_INPUT through worker_done. These Orca constraints override pi-subagents-specific delegation wording above.\nObey Orca's injected lifecycle preamble and send worker_done exactly once when the assignment reaches a terminal outcome.\n\n## Assignment\n\n${assignment}`;
}

function parseQualifiedModel(value) {
  const separator = value.lastIndexOf(":");
  const qualified = separator > 0 ? value.slice(0, separator) : "";
  const thinking = separator > 0 ? value.slice(separator + 1) : "";
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(qualified) || !THINKING_LEVELS.has(thinking)) {
    throw new Error(`Invalid Minions model route for Orca: ${value}`);
  }
  return { qualified, thinking };
}

function piCommand(model) {
  const { qualified, thinking } = parseQualifiedModel(model);
  return `pi --model ${qualified} --thinking ${thinking}`;
}

function resultId(result, ...paths) {
  for (const keys of paths) {
    let value = result;
    for (const key of keys) value = value?.[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function summaryFromObject(value) {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  if (!parsed || typeof parsed !== "object") return "";
  for (const key of ["body", "summary", "output", "message", "result"]) {
    const summary = summaryFromObject(parsed[key]);
    if (summary) return summary;
  }
  return "";
}

function summaryFromShow(show) {
  for (const value of [show?.task?.result, show?.dispatch?.result, show?.worker?.result, show?.result]) {
    const summary = summaryFromObject(value);
    if (summary) return summary;
  }
  return "";
}

function outputFromRead(read) {
  if (!read || typeof read !== "object") return "";
  if (read.source === "transcript" && Array.isArray(read.transcript?.messages)) {
    const assistant = [...read.transcript.messages].reverse().find((message) => message?.role === "assistant");
    const messages = assistant ? [assistant] : read.transcript.messages.slice(-3);
    return messages.map((message) => (message.blocks ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n"))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  const tail = read.terminal?.tail;
  return Array.isArray(tail) ? tail.join("\n").trim() : "";
}

function normalizedState(show, requestedStop = false) {
  const values = [
    show?.task?.status,
    show?.dispatch?.status,
    show?.worker?.state,
    show?.worker?.stage,
    show?.state,
  ].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
  if (values.some((value) => ["failed", "failure", "error"].includes(value))) return "failed";
  if (values.some((value) => ["stopped", "cancelled", "canceled", "abandoned"].includes(value))) return "stopped";
  if (values.some((value) => ["completed", "complete", "succeeded", "done", "settled", "released"].includes(value))) return "complete";
  if (requestedStop && values.some((value) => value === "stop_unknown")) return "running";
  return "running";
}

function completion(show, state, summary, runId) {
  return {
    id: runId,
    runId,
    state,
    success: state === "complete",
    summary,
    error: show?.worker?.lastError ?? show?.lastError ?? (state === "failed" ? "Orca worker failed." : undefined),
    endedAt: Date.now(),
  };
}

function displayName(agent) {
  return `Minions ${roleFromAgent(agent)}`.slice(0, 60);
}

export function createOrcaRuntime({
  callOrca,
  host,
  readRolePrompt = defaultReadRolePrompt,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
} = {}) {
  if (typeof callOrca !== "function") throw new Error("Orca runtime requires a CLI caller.");
  if (!host?.terminalHandle) throw new Error("Orca runtime requires the coordinator terminal identity.");
  let activeRunId;

  async function createTask(params, { resumed = false } = {}) {
    const result = await callOrca([
      "orchestration", "task-create",
      "--spec", buildWorkerPrompt(params, readRolePrompt, { resumed }),
      "--task-title", displayName(params.agent),
      "--display-name", displayName(params.agent),
      "--run", activeRunId,
    ]);
    const taskId = resultId(result, ["task", "id"], ["taskId"]);
    if (!taskId) throw new Error("Orca task-create returned no task id.");
    return taskId;
  }

  async function readWorker(dispatchId) {
    try {
      return await callOrca(["orchestration", "worker-read", "--dispatch", dispatchId, "--limit", "200"]);
    } catch {
      return undefined;
    }
  }

  async function failUndispatchedTask(taskId, terminalId, reason) {
    if (terminalId) {
      try {
        await callOrca(["terminal", "close", "--terminal", terminalId]);
      } catch {
        // Preserve the original launch failure; Orca reports residual terminals in its UI.
      }
    }
    if (taskId) {
      try {
        await callOrca([
          "orchestration", "task-update",
          "--id", taskId,
          "--status", "failed",
          "--result", JSON.stringify({ error: reason }),
          "--run", activeRunId,
        ]);
      } catch {
        // Preserve the original launch failure.
      }
    }
  }

  return {
    kind: "orca",
    async call(method, params = {}) {
      if (method === "ping") {
        const status = await callOrca(["status"]);
        if (status?.runtime?.state !== "ready" || status?.graph?.state !== "ready") {
          throw new Error("Orca is not ready for native Minions workers.");
        }
        if (!(status.runtime.capabilities ?? []).includes(REQUIRED_ORCA_CAPABILITY)) {
          throw new Error(`Orca is missing required capability ${REQUIRED_ORCA_CAPABILITY}.`);
        }
        const runResult = params.runId
          ? await callOrca(["orchestration", "run-use", "--id", params.runId])
          : await callOrca(["orchestration", "run-create", "--objective", "Pi Minions native orchestration"]);
        activeRunId = resultId(runResult, ["run", "id"], ["runId"]);
        if (!activeRunId) throw new Error("Orca returned no orchestration Run id.");
        return {
          runtime: "orca",
          version: 1,
          methods: ["ping", "status", "spawn", "steer", "stop", "resume", "release"],
          runId: activeRunId,
          capabilities: status.runtime.capabilities,
        };
      }
      if (!activeRunId) throw new Error("Start the Orca Minions runtime before using workers.");

      if (method === "spawn") {
        let taskId;
        let terminalId;
        let dispatchAttempted = false;
        try {
          await callOrca(["worktree", "show", "--worktree", `path:${params.cwd}`]);
          taskId = await createTask(params);
          const terminal = await callOrca([
            "terminal", "create",
            "--worktree", `path:${params.cwd}`,
            "--title", displayName(params.agent),
            "--command", piCommand(params.model),
          ]);
          terminalId = resultId(terminal, ["terminal", "handle"], ["handle"]);
          if (!terminalId) throw new Error("Orca terminal-create returned no terminal handle.");
          const ready = await callOrca([
            "terminal", "wait",
            "--terminal", terminalId,
            "--for", "tui-idle",
            "--timeout-ms", String(readyTimeoutMs),
          ], { timeoutMs: readyTimeoutMs + 10_000 });
          if (ready?.wait?.satisfied === false) throw new Error(`Orca Pi worker did not become ready: ${ready.wait.blockedReason ?? ready.wait.status ?? "timeout"}`);
          dispatchAttempted = true;
          const dispatched = await callOrca([
            "orchestration", "dispatch",
            "--task", taskId,
            "--to", terminalId,
            "--run", activeRunId,
            "--inject",
          ]);
          const dispatchId = resultId(dispatched, ["dispatch", "id"], ["dispatchId"]);
          if (!dispatchId) throw new Error("Orca dispatch returned no dispatch id.");
          return {
            text: `Orca worker ${dispatchId} started in ${params.cwd}.`,
            details: {
              asyncId: `orca:${dispatchId}`,
              runtimeAgentId: dispatchId,
              runtimeTerminalId: terminalId,
              runtimeTaskId: taskId,
            },
          };
        } catch (error) {
          if (dispatchAttempted && taskId && terminalId) {
            try {
              const recovered = await callOrca(["orchestration", "dispatch-show", "--task", taskId]);
              const dispatchId = resultId(recovered, ["dispatch", "id"], ["dispatchId"]);
              if (dispatchId) {
                return {
                  text: `Recovered Orca worker ${dispatchId} after an uncertain dispatch reply.`,
                  details: {
                    asyncId: `orca:${dispatchId}`,
                    runtimeAgentId: dispatchId,
                    runtimeTerminalId: terminalId,
                    runtimeTaskId: taskId,
                  },
                };
              }
            } catch {
              // The dispatch outcome remains uncertain. Preserve the terminal and
              // Task rather than risking cancellation of a worker that may be live.
              throw new Error(`Orca dispatch outcome is uncertain for Task ${taskId}; inspect it with orchestration dispatch-show before retrying. Original error: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          await failUndispatchedTask(taskId, terminalId, error instanceof Error ? error.message : String(error));
          throw error;
        }
      }

      if (method === "status") {
        const show = await callOrca(["orchestration", "worker-show", "--dispatch", params.id]);
        const state = normalizedState(show, params.requestedStop);
        const read = params.includeActivity === false ? undefined : await readWorker(params.id);
        const summary = summaryFromShow(show) || outputFromRead(read);
        const error = show?.worker?.lastError ?? show?.lastError;
        const uncertain = [show?.worker?.state, show?.state].includes("outcome_unknown")
          ? "\nOrca reports outcome_unknown; the worker and worktree lease remain active until stopped or terminal proof appears."
          : "";
        return {
          text: `Run: ${params.id}\nState: ${state}${error ? `\nError: ${error}` : ""}${uncertain}${summary ? `\n\n${summary}` : ""}`,
          details: {
            show,
            read,
            ...(state === "running" ? {} : { completion: completion(show, state, summary, params.runId ?? `orca:${params.id}`) }),
          },
        };
      }

      if (method === "steer") {
        if (!params.terminalId) throw new Error(`Orca worker ${params.id} has no terminal identity for steering.`);
        const result = await callOrca([
          "terminal", "send",
          "--terminal", params.terminalId,
          "--text", `[Minions guidance]\n${params.message}`,
          "--interrupt",
        ]);
        return { text: `Orca accepted guidance for ${params.id}.`, details: result };
      }

      if (method === "resume") {
        if (!params.terminalId) throw new Error(`Orca worker ${params.id} has no reusable terminal identity.`);
        const taskId = await createTask(params, { resumed: true });
        let result;
        try {
          result = await callOrca([
            "orchestration", "worker-start",
            "--task", taskId,
            "--terminal", params.terminalId,
            "--run", activeRunId,
          ], { timeoutMs: readyTimeoutMs + 10_000 });
        } catch (error) {
          try {
            const recovered = await callOrca(["orchestration", "dispatch-show", "--task", taskId]);
            const recoveredId = resultId(recovered, ["dispatch", "id"], ["dispatchId"]);
            if (!recoveredId) throw error;
            result = { state: "ready", dispatchId: recoveredId };
          } catch {
            throw new Error(`Orca follow-up outcome is uncertain for Task ${taskId}; inspect it with orchestration dispatch-show before retrying. Original error: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const dispatchId = resultId(result, ["dispatchId"], ["dispatch", "id"]);
        if (result?.state !== "ready" || !dispatchId) {
          throw new Error(result?.lastError ?? "Orca worker-start did not return a ready Dispatch.");
        }
        const terminalId = resultId(result, ["worker", "agent_terminal_handle"], ["agentTerminalHandle"]) ?? params.terminalId;
        return {
          text: `Orca worker resumed as Dispatch ${dispatchId}.`,
          details: {
            asyncId: `orca:${dispatchId}`,
            runtimeAgentId: dispatchId,
            runtimeTerminalId: terminalId,
            runtimeTaskId: taskId,
          },
        };
      }

      if (method === "stop") {
        const result = await callOrca(["orchestration", "worker-stop", "--dispatch", params.id]);
        if (result?.state === "stop_unknown") {
          throw new Error(result.lastError ?? `Orca could not prove that worker ${params.id} stopped; inspect worker-show before retrying.`);
        }
        return { runId: params.runId ?? `orca:${params.id}`, state: "stopping", details: result };
      }

      if (method === "release") {
        const result = await callOrca(["orchestration", "worker-release", "--dispatch", params.id]);
        if (result?.state === "release_unknown") {
          throw new Error(result.lastError ?? result.recovery ?? `Orca could not prove terminal release for worker ${params.id}.`);
        }
        return result;
      }

      throw new Error(`Unsupported Orca runtime method: ${method}`);
    },
  };
}

export function createOrcaRuntimeFromProcess(options = {}) {
  const host = options.host ?? discoverOrcaHost(options);
  if (!host) return undefined;
  const callOrca = options.callOrca ?? createOrcaCliCaller(host, options);
  return createOrcaRuntime({ ...options, host, callOrca });
}
