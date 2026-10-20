import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

for (const field of [
  "maxConsecutiveFailures",
  "maxMinutes",
  "maxTokens",
] as const) {
  for (const value of [undefined, 0, 1.5, -1, "2", null, true, 3]) {
    test(`config ${field}=${value}`, (t) => {
      const directory = mkdtempSync(join(tmpdir(), "ralph-config-"));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const path = join(directory, "config.json");
      writeFileSync(
        path,
        JSON.stringify({
          label: "phase-{phase}",
          branch: "phase-{phase}",
          maxIterations: 10,
          maxFixAttempts: 3,
          checks: [["check"]],
          [field]: value,
        }),
      );
      if (value === undefined || value === 3) {
        assert.equal(
          loadConfig(path, 1)[field],
          value ?? (field === "maxConsecutiveFailures" ? 2 : undefined),
        );
      } else assert.throws(() => loadConfig(path, 1), new RegExp(field));
    });
  }
}
