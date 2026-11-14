import { resolve } from "node:path";
import { defineWorkspace } from "vitest/config";

const alias = {
  "@factory-arena/protocol": resolve(import.meta.dirname, "packages/protocol/dist/index.js"),
  "@factory-arena/core": resolve(import.meta.dirname, "packages/core/dist/index.js"),
  "@factory-arena/adapters": resolve(import.meta.dirname, "packages/adapters/dist/index.js"),
  "@factory-arena/hub-server": resolve(import.meta.dirname, "apps/hub-server/dist/index.js")
};

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: "unit",
      include: ["tests/unit/**/*.spec.ts"],
      environment: "node",
    },
  },
  {
    resolve: { alias },
    test: {
      name: "contract",
      include: ["tests/contract/**/*.spec.ts"],
      environment: "node",
      testTimeout: 20000
    }
  },
  {
    resolve: { alias },
    test: {
      name: "integration",
      include: ["tests/integration/**/*.spec.ts"],
      environment: "node",
      testTimeout: 30000,
      fileParallelism: false
    }
  }
]);
