import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "./git-test-helpers.ts";
import { diffHash, parkFailedChanges, startTaskBranch } from "./git.ts";

test("failed changes stash tracked, staged and untracked files and retain branch", async (t) => {
  const { directory, run } = await repository(t);
  await startTaskBranch(run, 8, "ralph/phase-2");
  writeFileSync(join(directory, "staged"), "staged\n");
  await run(["git", "add", "staged"]);
  writeFileSync(join(directory, "new"), "untracked\n");
  const hash = await diffHash(run);
  const stash = await parkFailedChanges(run, "ralph/phase-2", 8);
  assert.match(stash, /^[a-f0-9]{40}$/);
  assert.match((await run(["git", "stash", "list"])).stdout, /ralph failed #8/);
  assert.equal(
    (await run(["git", "branch", "--show-current"])).stdout.trim(),
    "ralph/phase-2",
  );
  assert.equal((await run(["git", "status", "--porcelain"])).stdout, "");
  await run(["git", "switch", "issue-8"]);
  await run(["git", "stash", "apply", stash]);
  assert.equal(await diffHash(run), hash);
});
test("diff hash covers staged, unstaged, binary and untracked contents and names", async (t) => {
  const { directory, run } = await repository(t);
  const before = await diffHash(run);
  writeFileSync(join(directory, "new"), Buffer.from([0, 1, 2]));
  const untracked = await diffHash(run);
  assert.notEqual(untracked, before);
  assert.equal(await diffHash(run), untracked);
  writeFileSync(join(directory, "new"), Buffer.from([0, 1, 3]));
  assert.notEqual(await diffHash(run), untracked);
  await run(["git", "add", "new"]);
  const staged = await diffHash(run);
  writeFileSync(join(directory, "new"), Buffer.from([0, 1, 4]));
  assert.notEqual(await diffHash(run), staged);
});
