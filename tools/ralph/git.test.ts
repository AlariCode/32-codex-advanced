import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner } from "./exec.ts";
import { startTaskBranch } from "./git.ts";

async function repository(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ralph-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = createRunner(directory, () => {});
  await run(["git", "init", "--initial-branch=ralph/phase-2"]);
  await run(["git", "config", "user.name", "Ralph Test"]);
  await run(["git", "config", "user.email", "ralph@example.test"]);
  await run(["git", "config", "commit.gpgsign", "false"]);
  await run(["git", "commit", "--allow-empty", "-m", "Initial"]);
  return { directory, run };
}

test("startTaskBranch creates a missing task branch from the phase", async (t) => {
  const { run } = await repository(t);
  const phase = (await run(["git", "rev-parse", "HEAD"])).stdout;
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "issue-8",
  );
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, phase);
});

test("startTaskBranch resumes an existing branch without resetting its commits", async (t) => {
  const { run } = await repository(t);
  await run(["git", "switch", "-c", "issue-8"]);
  await run(["git", "commit", "--allow-empty", "-m", "Saved task work"]);
  const saved = (await run(["git", "rev-parse", "HEAD"])).stdout;
  await run(["git", "switch", "ralph/phase-2"]);
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "issue-8",
  );
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, saved);
  await startTaskBranch(run, 8, "ralph/phase-2");
  assert.equal((await run(["git", "rev-parse", "HEAD"])).stdout, saved);
});

test("startTaskBranch rejects a dirty working tree before switching branches", async (t) => {
  const { directory, run } = await repository(t);
  await run(["git", "branch", "issue-8"]);
  await writeFile(join(directory, "unfinished.txt"), "saved work");
  await assert.rejects(
    startTaskBranch(run, 8, "ralph/phase-2"),
    /Working tree must be clean/,
  );
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "ralph/phase-2",
  );
});
