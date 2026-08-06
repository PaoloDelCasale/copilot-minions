import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PASEO_MCP_PATHNAME = "/mcp/agents";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const ROLE_PROMPT_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "agents");

function readArgValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) return argv[index + 1];
    if (value?.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return undefined;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

export function discoverPaseoMcpServer({ argv = process.argv, env = process.env, readFile = fs.readFileSync } = {}) {
  const callerAgentId = env.PASEO_AGENT_ID?.trim();
  if (!callerAgentId) return undefined;
  const configPath = readArgValue(argv, "--mcp-config");
  if (!configPath) return undefined;

  let config;
  try {
    config = JSON.parse(readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read Paseo's Pi MCP config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const servers = asObject(config?.mcpServers) ?? asObject(config?.["mcp-servers"]);
  const server = asObject(servers?.paseo);
  if (!server || typeof server.url !== "string") return undefined;

  let url;
  try {
    url = new URL(server.url);
  } catch {
    return undefined;
  }
  if (url.pathname !== PASEO_MCP_PATHNAME || url.searchParams.get("callerAgentId") !== callerAgentId) {
    return undefined;
  }
  return {
    url: url.toString(),
    headers: asObject(server.headers) ?? {},
    callerAgentId,
    configPath,
  };
}

function parseMcpPayload(text, contentType, requestId) {
  const messages = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Ignore comments and non-JSON SSE data.
      }
    }
  } else if (text.trim()) {
    const parsed = JSON.parse(text);
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const reply = messages.find((message) => message?.id === requestId) ?? messages.at(-1);
  if (!reply) throw new Error("Paseo MCP returned no JSON-RPC response.");
  if (reply.error) throw new Error(`Paseo MCP ${reply.error.code ?? "error"}: ${reply.error.message ?? "unknown error"}`);
  return reply.result;
}

function mcpErrorText(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function createPaseoToolCaller(server, {
  fetchImpl = globalThis.fetch,
  idFactory = randomUUID,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Paseo MCP requires fetch support.");
  return async function callTool(name, args = {}) {
    const requestId = idFactory();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Paseo MCP ${name} timed out.`)), requestTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(server.url, {
        method: "POST",
        headers: {
          ...server.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Paseo MCP ${name} failed (${response.status}): ${text || response.statusText}`);
      const result = parseMcpPayload(text, response.headers.get("content-type") ?? "", requestId);
      if (result?.isError) throw new Error(mcpErrorText(result) || `Paseo tool ${name} failed.`);
      if (result?.structuredContent !== undefined) return result.structuredContent;
      const textContent = mcpErrorText(result);
      if (!textContent) return {};
      try {
        return JSON.parse(textContent);
      } catch {
        return { text: textContent };
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return markdown.trim();
  const end = markdown.indexOf("\n---", 3);
  return end < 0 ? markdown.trim() : markdown.slice(end + 4).trim();
}

function defaultReadRolePrompt(agent) {
  if (!/^pi-minions-[a-z-]+$/.test(agent)) throw new Error(`Invalid Paseo worker agent: ${agent}`);
  return stripFrontmatter(fs.readFileSync(path.join(ROLE_PROMPT_DIRECTORY, `${agent}.md`), "utf8"));
}

function roleFromAgent(agent) {
  return agent.replace(/^pi-minions-/, "");
}

function buildWorkerPrompt(params, readRolePrompt) {
  const role = roleFromAgent(params.agent);
  const nestedGuidance = role === "reviewer"
    ? "If the review contract requires two independent axes, you may create only those bounded nested reviewers. Track their returned IDs directly and control only those IDs; never discover or reuse agents through a workspace-wide list."
    : "Do not create or delegate to additional agents. Never call Paseo agent lifecycle or control tools.";
  return `You are a Paseo-managed Minions ${role} worker. Complete only this bounded assignment.\n\n${readRolePrompt(params.agent)}\n\n## Paseo runtime constraints\n\n${nestedGuidance}\nNever list, inspect, prompt, steer, stop, cancel, or resume top-level Minions workers or sibling Pi processes. Worker lifecycle belongs exclusively to the Minions frontier.\nDo not call minions_start or any minions_* orchestration tool. These Paseo constraints override any pi-subagents-specific delegation wording above.\n\n## Assignment\n\n${params.task}`;
}

function parseQualifiedModel(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= value.indexOf("/")) throw new Error(`Invalid Minions model route for Paseo: ${value}`);
  return {
    model: value.slice(0, separator),
    thinking: value.slice(separator + 1),
  };
}

function paseoState(snapshot, requestedStop = false) {
  if (requestedStop && snapshot?.status === "idle") return "stopped";
  if ((snapshot?.pendingPermissions?.length ?? 0) > 0) return "running";
  if (snapshot?.status === "initializing" || snapshot?.status === "running") return "running";
  if (snapshot?.status === "idle") return snapshot?.lastError ? "failed" : "complete";
  if (snapshot?.status === "closed") return "stopped";
  return "failed";
}

function completionFromSnapshot(snapshot, state, summary, runId) {
  const usage = snapshot?.lastUsage;
  const input = Number(usage?.inputTokens) || 0;
  const cacheRead = Number(usage?.cachedInputTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  return {
    id: runId,
    runId,
    state,
    success: state === "complete",
    summary,
    error: snapshot?.lastError ?? (state === "failed" ? "Paseo agent failed." : undefined),
    endedAt: Date.parse(snapshot?.updatedAt) || Date.now(),
    ...(input || cacheRead || output
      ? { totalTokens: { input, cacheRead, output, total: input + cacheRead + output } }
      : {}),
    ...(Number(usage?.totalCostUsd)
      ? { totalCost: { inputTokens: input, outputTokens: output, costUsd: Number(usage.totalCostUsd) } }
      : {}),
  };
}

export function createPaseoRuntime({
  callTool,
  idFactory = randomUUID,
  readRolePrompt = defaultReadRolePrompt,
} = {}) {
  if (typeof callTool !== "function") throw new Error("Paseo runtime requires an MCP tool caller.");
  return {
    kind: "paseo",
    async call(method, params = {}) {
      if (method === "ping") {
        const result = await callTool("list_providers", {});
        const providers = result?.providers ?? [];
        const piProvider = providers.find((provider) => provider?.id === "pi");
        if (!piProvider || piProvider.enabled === false) {
          throw new Error("Paseo does not expose an enabled Pi provider for native Minions workers.");
        }
        return {
          runtime: "paseo",
          version: 1,
          methods: ["ping", "status", "spawn", "steer", "stop", "resume", "release"],
          providers,
        };
      }
      if (method === "spawn") {
        if (params.timeoutMs) {
          throw new Error("Paseo-managed Minions does not yet support persistent worker deadlines; omit timeoutSeconds.");
        }
        const { model, thinking } = parseQualifiedModel(params.model);
        const result = await callTool("create_agent", {
          title: `Minions ${roleFromAgent(params.agent)}`.slice(0, 60),
          provider: `pi/${model}`,
          initialPrompt: buildWorkerPrompt(params, readRolePrompt),
          settings: { thinkingOptionId: thinking },
          relationship: { kind: "subagent" },
          workspace: { kind: "current", cwd: params.cwd },
          notifyOnFinish: true,
        });
        if (!result?.agentId) throw new Error("Paseo create_agent returned no agentId.");
        return {
          text: result.guidance ?? `Paseo agent ${result.agentId} started.`,
          details: {
            asyncId: `paseo:${result.agentId}:${idFactory()}`,
            runtimeAgentId: result.agentId,
          },
        };
      }
      if (method === "status") {
        const result = await callTool("get_agent_status", { agentId: params.id });
        const snapshot = result?.snapshot;
        if (!snapshot) throw new Error(`Paseo returned no snapshot for agent ${params.id}.`);
        const state = paseoState(snapshot, params.requestedStop);
        const activity = params.includeActivity === false
          ? undefined
          : await callTool("get_agent_activity", { agentId: params.id, limit: 20 });
        const summary = activity?.content ?? "";
        const errorLine = snapshot.lastError ? `\nError: ${snapshot.lastError}` : "";
        const permissionLine = snapshot.pendingPermissions?.length
          ? `\nPermission: Paseo agent ${params.id} is waiting for approval in Paseo.`
          : "";
        const completion = ["complete", "failed", "stopped", "paused"].includes(state)
          ? completionFromSnapshot(snapshot, state, summary, params.runId ?? params.id)
          : undefined;
        return {
          text: `Run: ${params.id}\nState: ${state}${errorLine}${permissionLine}${summary ? `\n\n${summary}` : ""}`,
          details: { snapshot, ...(completion ? { completion } : {}) },
        };
      }
      if (method === "steer") {
        const result = await callTool("send_agent_prompt", {
          agentId: params.id,
          prompt: params.message,
          background: true,
          notifyOnFinish: true,
        });
        return { text: result?.guidance ?? `Prompt sent to Paseo agent ${params.id}.` };
      }
      if (method === "resume") {
        const result = await callTool("send_agent_prompt", {
          agentId: params.id,
          prompt: params.message,
          background: true,
          notifyOnFinish: true,
        });
        return {
          text: result?.guidance ?? `Paseo agent ${params.id} resumed.`,
          details: {
            asyncId: `paseo:${params.id}:${idFactory()}`,
            runtimeAgentId: params.id,
          },
        };
      }
      if (method === "stop") {
        const result = await callTool("cancel_agent", { agentId: params.id });
        return { runId: params.runId ?? params.id, state: result?.success === false ? "running" : "stopping" };
      }
      if (method === "release") {
        try {
          const result = await callTool("archive_agent", { agentId: params.id });
          if (result?.success === false) {
            const message = result.error ?? result.message ?? `Paseo refused to archive agent ${params.id}.`;
            if (/agent_(?:not_found|archived)|already archived|\bagent\b[^\n]{0,160}\bnot found\b/i.test(message)) {
              return { state: "released", processAction: "already-archived", details: result };
            }
            throw new Error(message);
          }
          return { state: "released", processAction: "archive-agent", details: result };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/agent_(?:not_found|archived)|already archived|\bagent\b[^\n]{0,160}\bnot found\b/i.test(message)) {
            return { state: "released", processAction: "already-archived" };
          }
          throw error;
        }
      }
      throw new Error(`Unsupported Paseo runtime method: ${method}`);
    },
  };
}

export function createPaseoRuntimeFromProcess(options = {}) {
  const server = options.server ?? discoverPaseoMcpServer(options);
  if (!server) return undefined;
  const callTool = options.callTool ?? createPaseoToolCaller(server, options);
  return createPaseoRuntime({ ...options, callTool });
}
