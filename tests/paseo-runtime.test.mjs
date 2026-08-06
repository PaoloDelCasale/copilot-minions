import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPaseoRuntime,
  createPaseoToolCaller,
  discoverPaseoMcpServer,
} from "../extensions/pi-minions/paseo-runtime.mjs";

test("Paseo discovery accepts only the agent-scoped MCP config injected into Pi", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "minions-paseo-test-"));
  const configPath = path.join(directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      paseo: {
        url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=parent-1",
        headers: { Authorization: "Bearer test-token" },
      },
    },
  }));
  try {
    const found = discoverPaseoMcpServer({
      argv: ["pi", "--mcp-config", configPath],
      env: { PASEO_AGENT_ID: "parent-1" },
    });
    assert.equal(found.callerAgentId, "parent-1");
    assert.equal(found.headers.Authorization, "Bearer test-token");
    assert.equal(new URL(found.url).pathname, "/mcp/agents");

    assert.equal(discoverPaseoMcpServer({
      argv: ["pi", `--mcp-config=${configPath}`],
      env: { PASEO_AGENT_ID: "another-agent" },
    }), undefined);
    assert.equal(discoverPaseoMcpServer({ argv: ["pi"], env: {} }), undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the Paseo tool caller handles stateless JSON and SSE MCP responses", async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ jsonrpc: "2.0", id: "request-1", result: { structuredContent: { ok: 1 } } }), {
      headers: { "content-type": "application/json" },
    }),
    new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: "request-2", result: { structuredContent: { ok: 2 } } })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    }),
  ];
  const call = createPaseoToolCaller({
    url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=parent-1",
    headers: { Authorization: "Bearer test" },
  }, {
    idFactory: (() => {
      let next = 1;
      return () => `request-${next++}`;
    })(),
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return responses.shift();
    },
  });

  assert.deepEqual(await call("first", { value: 1 }), { ok: 1 });
  assert.deepEqual(await call("second", { value: 2 }), { ok: 2 });
  assert.equal(requests[0].headers.Authorization, "Bearer test");
  assert.equal(requests[0].headers["mcp-protocol-version"], "2025-06-18");
  assert.equal(JSON.parse(requests[0].body).method, "tools/call");
});

test("the Paseo runtime creates native child agents and normalizes their lifecycle", async () => {
  const calls = [];
  let status = "running";
  let pendingPermissions = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === "list_providers") return { providers: [{ id: "pi" }] };
    if (name === "create_agent") return { agentId: "agent-child", status: "running" };
    if (name === "get_agent_status") {
      return {
        status,
        snapshot: {
          id: "agent-child",
          status,
          pendingPermissions,
          updatedAt: "2026-07-31T12:00:00.000Z",
          lastUsage: {
            inputTokens: 20,
            cachedInputTokens: 5,
            outputTokens: 7,
            totalCostUsd: 0.04,
          },
        },
      };
    }
    if (name === "get_agent_activity") return { content: "Assistant: finished" };
    if (name === "send_agent_prompt") return { success: true, status: "running" };
    if (name === "cancel_agent") return { success: true };
    if (name === "archive_agent") return { success: true };
    throw new Error(`Unexpected tool ${name}`);
  };
  let nextId = 1;
  const runtime = createPaseoRuntime({
    callTool,
    idFactory: () => `execution-${nextId++}`,
    readRolePrompt: () => "Read-only role contract.",
  });

  assert.equal((await runtime.call("ping")).runtime, "paseo");
  const spawned = await runtime.call("spawn", {
    agent: "pi-minions-explorer",
    task: "Inspect auth",
    cwd: "C:/repo",
    model: "github-copilot/grok-4.5:high",
    async: true,
  });
  assert.equal(spawned.details.runtimeAgentId, "agent-child");
  assert.equal(spawned.details.asyncId, "paseo:agent-child:execution-1");
  const create = calls.find((call) => call.name === "create_agent");
  assert.equal(create.args.provider, "pi/github-copilot/grok-4.5");
  assert.equal(create.args.settings.thinkingOptionId, "high");
  assert.deepEqual(create.args.relationship, { kind: "subagent" });
  assert.deepEqual(create.args.workspace, { kind: "current", cwd: "C:/repo" });
  assert.match(create.args.initialPrompt, /Do not create or delegate/);
  assert.match(create.args.initialPrompt, /Never call Paseo agent lifecycle or control tools/);
  assert.match(create.args.initialPrompt, /Never list, inspect, prompt, steer, stop, cancel, or resume top-level Minions workers/);
  assert.match(create.args.initialPrompt, /Inspect auth/);

  pendingPermissions = [{ id: "permission-1" }];
  const awaitingPermission = await runtime.call("status", {
    id: "agent-child",
    runId: spawned.details.asyncId,
  });
  assert.equal(awaitingPermission.details.completion, undefined);
  assert.match(awaitingPermission.text, /waiting for approval in Paseo/);

  pendingPermissions = [];
  status = "idle";
  const result = await runtime.call("status", {
    id: "agent-child",
    runId: spawned.details.asyncId,
  });
  assert.equal(result.details.completion.state, "complete");
  assert.equal(result.details.completion.totalTokens.total, 32);
  assert.equal(result.details.completion.totalTokens.cacheRead, 5);
  assert.equal(result.details.completion.totalCost.costUsd, 0.04);
  const activityCalls = calls.filter((call) => call.name === "get_agent_activity").length;
  await runtime.call("status", {
    id: "agent-child",
    runId: spawned.details.asyncId,
    includeActivity: false,
  });
  assert.equal(calls.filter((call) => call.name === "get_agent_activity").length, activityCalls);

  const resumed = await runtime.call("resume", { id: "agent-child", message: "Continue" });
  assert.equal(resumed.details.runtimeAgentId, "agent-child");
  assert.equal(resumed.details.asyncId, "paseo:agent-child:execution-2");
  await runtime.call("stop", { id: "agent-child", runId: resumed.details.asyncId });
  assert.deepEqual(calls.at(-1), { name: "cancel_agent", args: { agentId: "agent-child" } });
  const released = await runtime.call("release", { id: "agent-child" });
  assert.equal(released.state, "released");
  assert.deepEqual(calls.at(-1), { name: "archive_agent", args: { agentId: "agent-child" } });
});

test("Paseo release treats an already archived run-owned agent as disposed", async () => {
  const runtime = createPaseoRuntime({
    callTool: async (name) => {
      if (name === "archive_agent") throw new Error("Paseo MCP agent_not_found: already archived");
      throw new Error(`Unexpected tool ${name}`);
    },
  });
  const released = await runtime.call("release", { id: "agent-gone" });
  assert.equal(released.state, "released");
  assert.equal(released.processAction, "already-archived");
});
