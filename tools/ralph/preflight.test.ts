import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflight } from "./preflight.ts";
import type { CommandRunner } from "./exec.ts";

test("preflight checks a clean tree and runs every command into preflight.log", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ralph-preflight-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls: string[][] = [];
  const run: CommandRunner = async (command, options) => {
    calls.push(command);
    if (options?.stdoutFile)
      appendFileSync(options.stdoutFile, `${command[0]} output\n`);
    return { code: command[0] === "red" ? 1 : 0, stdout: "", stderr: "" };
  };
  assert.equal(await preflight(run, [["red"], ["green"]], directory), false);
  assert.deepEqual(calls.slice(-2), [["red"], ["green"]]);
  const text = readFileSync(join(directory, "preflight.log"), "utf8");
  assert.match(text, /red output/);
  assert.match(text, /green output/);
});
