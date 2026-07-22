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

const schemas = {
  start: Type.Object({
    variant: StringEnum(["standard", "lb"] as const, {
      description: "Routing profile selected by the invoked Pi minions skill.",
      default: "standard",
    }),
  }),
  spawn: Type.Object({
    tasks: Type.Array(Type.Object({
      role: Role,
      task: Type.String({ description: "Complete bounded worker prompt, including STATUS contract." }),
      cwd: Type.Optional(Type.String({ description: "Absolute repository or worktree path." })),
      routeOverride: Type.Optional(StringEnum([
        "mechanical-judgment",
        "escalate-entry",
        "escalate-sol-low",
        "escalate-sol-medium",
        "escalate-sol-high",
        "escalate-sol-max",
      ] as const, { description: "Named route from the documented judgment or escalation ladder." })),
      modelOverride: Type.Optional(Type.String({ description: "Model ID only; use exclusively for an explicit user override." })),
      timeoutSeconds: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 3600,
        description: "Optional hard worker deadline in seconds.",
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
  stop: Type.Object({
    workerIds: Type.Optional(Type.Array(Type.String(), { description: "Worker IDs; omit to stop every in-flight worker." })),
  }),
  close: Type.Object({}),
};

export default function (pi: ExtensionAPI) {
  createPiMinionsExtension(pi, { schemas });
}
