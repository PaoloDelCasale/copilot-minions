// managed-by: copilot-minions
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createPiMinionsExtension } from "./orchestrator.mjs";

const Role = StringEnum([
  "mechanical",
  "explorer",
  "implementer",
  "architect",
  "reviewer",
  "planner",
] as const);

const BudgetClass = StringEnum(["normal", "closure"] as const, {
  description: "Use closure only for already-boarded fix, review, gate, commit, or landing work after the soft triage limit.",
  default: "normal",
});

const OverrideReason = StringEnum([
  "merge-conflict",
  "github-judgment",
  "worker-failure",
  "verification-failure",
  "blocked",
  "review-changes-required",
  "mediocre-result",
] as const, {
  description: "Mandatory structured evidence category for a named route override; omit with normal role routing.",
});

export const schemas = {
  start: Type.Object({
    variant: StringEnum(["standard", "lb"] as const, {
      description: "Routing profile selected by the invoked Pi minions skill.",
      default: "standard",
    }),
    maxRunCostUsd: Type.Optional(Type.Number({
      exclusiveMinimum: 0,
      maximum: 500,
      description: "Optional run-wide cost ceiling; defaults to 40 USD.",
    })),
  }),
  spawn: Type.Object({
    tasks: Type.Array(Type.Object({
      role: Role,
      task: Type.String({ description: "Complete bounded worker prompt, including STATUS contract." }),
      budgetClass: Type.Optional(BudgetClass),
      cwd: Type.Optional(Type.String({ description: "Absolute repository or worktree path." })),
      routeOverride: Type.Optional(StringEnum([
        "mechanical-judgment",
        "escalate-entry",
        "escalate-sol-low",
        "escalate-sol-medium",
        "escalate-sol-high",
        "escalate-sol-max",
      ] as const, {
        description: "Exceptional named route only. Omit for normal dispatch; overrideReason is mandatory, and escalation also requires overrideFromWorkerId. Invalid overrides are audited and downgraded to the normal role route.",
      })),
      overrideReason: Type.Optional(OverrideReason),
      overrideFromWorkerId: Type.Optional(Type.String({
        description: "Terminal, triaged worker whose recorded result justifies an escalation override. Omit for normal routing and mechanical judgment.",
      })),
      modelOverride: Type.Optional(Type.String({
        description: "Model ID only; omit this key entirely unless the user explicitly requested an override. Never pass an empty string.",
      })),
      timeoutSeconds: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 3600,
        description: "Ordinary Pi only: optional package-owned hard deadline. NEVER set this on Paseo; Paseo ignores it and uses maxDurationSeconds.",
      })),
      maxCostUsd: Type.Optional(Type.Number({
        exclusiveMinimum: 0,
        maximum: 100,
        description: "Optional worker cost ceiling; defaults are model-aware.",
      })),
      maxDurationSeconds: Type.Optional(Type.Integer({
        minimum: 60,
        maximum: 14400,
        description: "Optional model-aware worker wall-clock watchdog; this is the only duration field to use on Paseo.",
      })),
    }), { minItems: 1, maxItems: 6 }),
  }),
  read: Type.Object({
    workerIds: Type.Optional(Type.Array(Type.String(), { description: "Worker IDs; omit to read all workers." })),
  }),
  steer: Type.Object({
    workerId: Type.String(),
    message: Type.String(),
  }),
  resume: Type.Object({
    workerId: Type.String(),
    message: Type.String({ description: "Follow-up instruction for a paused, failed, or completed worker." }),
  }),
  stop: Type.Object({
    workerIds: Type.Optional(Type.Array(Type.String(), { description: "Worker IDs; omit to stop every in-flight worker." })),
  }),
  close: Type.Object({}),
};

export default function (pi: ExtensionAPI) {
  createPiMinionsExtension(pi, { schemas });
}
