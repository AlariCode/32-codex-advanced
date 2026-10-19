import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

for (const value of [undefined, 0, 1.5, -1, "3", null, true]) {
  test(`rejects maxFixAttempts=${JSON.stringify(value)}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ralph-config-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        label: "phase-{phase}",
        branch: "ralph/phase-{phase}",
        maxIterations: 10,
        checks: [["make", "check"]],
        maxFixAttempts: value,
      }),
    );
    assert.throws(
      () => loadConfig(file, 2),
      /maxFixAttempts must be a positive integer/,
    );
  });
}

test("loads the configured fix limit and substitutes the phase", () => {
  const config = loadConfig(
    new URL("./ralph.config.json", import.meta.url).pathname,
    2,
  );
  assert.equal(config.maxFixAttempts, 3);
  assert.equal(config.branch, "ralph/phase-2");
  assert.equal(config.label, "phase-2");
});
