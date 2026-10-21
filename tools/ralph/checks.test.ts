import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "./checks.ts";
import type { CommandRunner } from "./exec.ts";

test("checks allow an empty merge resolution but still require task changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ralph-checks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let checked = 0;
  const run: CommandRunner = async (command) => {
    if (command[0] !== "git") checked++;
    return { code: 0, stdout: "", stderr: "" };
  };
  const log = join(directory, "check.log");
  assert.equal(await runChecks(run, [["test"]], log), false);
  assert.equal(
    await runChecks(run, [["test"]], log, { requireChanges: false }),
    true,
  );
  assert.equal(checked, 2);
});

test("merge checks still fail on a red command and run remaining checks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ralph-checks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const commands: string[] = [];
  const run: CommandRunner = async (command) => {
    commands.push(command[0]);
    return { code: command[0] === "red" ? 1 : 0, stdout: "", stderr: "" };
  };
  assert.equal(
    await runChecks(run, [["red"], ["green"]], join(directory, "check.log"), {
      requireChanges: false,
    }),
    false,
  );
  assert.deepEqual(commands, ["git", "red", "green"]);
});
