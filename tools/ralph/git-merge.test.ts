import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeAndPush } from "./git.ts";
import { repository, mergeRepository } from "./git-test-helpers.ts";

test("mergeAndPush resolves a real conflict, checks it and pushes both parents", async (t) => {
  const { directory, run, remote, before } = await mergeRepository(t);
  let checks = 0;
  await mergeAndPush(run, 8, "ralph/phase-2", {
    resolve: async (files) => {
      assert.deepEqual(files, ["progress.md"]);
      await writeFile(
        join(directory, "progress.md"),
        "History\nPhase entry\nTask entry\n",
      );
    },
    check: async () => {
      checks++;
      assert.equal(
        (await run(["git", "diff", "--name-only", "--diff-filter=U"])).stdout,
        "",
      );
      return true;
    },
  });
  assert.equal(checks, 1);
  assert.equal((await run(["git", "status", "--porcelain"])).stdout, "");
  assert.equal(
    (await run(["git", "rev-parse", "HEAD^1"])).stdout.trim(),
    before,
  );
  assert.equal(
    (await run(["git", "rev-parse", "HEAD^2"])).stdout,
    (await run(["git", "rev-parse", "issue-8"])).stdout,
  );
  assert.equal(
    (
      await run([
        "git",
        "--git-dir",
        remote,
        "rev-parse",
        "refs/heads/ralph/phase-2",
      ])
    ).stdout,
    (await run(["git", "rev-parse", "HEAD"])).stdout,
  );
});

test("mergeAndPush skips conflict recovery for a clean merge", async (t) => {
  const { run } = await mergeRepository(t, false);
  const unexpected = async () => {
    throw new Error("Recovery must not run");
  };
  await mergeAndPush(run, 8, "ralph/phase-2", {
    resolve: unexpected,
    check: unexpected,
  });
  assert.equal((await run(["git", "status", "--porcelain"])).stdout, "");
});

for (const failure of ["agent", "unresolved", "checks", "aborted"] as const) {
  test(`mergeAndPush preserves work and never pushes on ${failure} recovery`, async (t) => {
    const { directory, run, remote, before } = await mergeRepository(t);
    let checks = 0;
    await assert.rejects(
      mergeAndPush(run, 8, "ralph/phase-2", {
        resolve: async () => {
          if (failure === "agent") throw new Error("Agent failed");
          if (failure === "unresolved") return;
          if (failure === "aborted") {
            await run(["git", "merge", "--abort"]);
            return;
          }
          await writeFile(
            join(directory, "progress.md"),
            "History\nPhase entry\nTask entry\n",
          );
        },
        check: async () => {
          checks++;
          return false;
        },
      }),
    );
    assert.equal(checks, failure === "checks" ? 1 : 0);
    assert.equal(
      (await run(["git", "rev-parse", "HEAD"])).stdout.trim(),
      before,
    );
    assert.equal(
      (
        await run([
          "git",
          "--git-dir",
          remote,
          "rev-parse",
          "refs/heads/ralph/phase-2",
        ])
      ).stdout.trim(),
      before,
    );
    if (failure !== "aborted")
      assert.equal(
        (await run(["git", "rev-parse", "--verify", "MERGE_HEAD"])).code,
        0,
      );
  });
}

test("mergeAndPush does not call Codex for a non-conflict merge error", async (t) => {
  const { run } = await repository(t);
  const unexpected = async () => {
    throw new Error("Recovery must not run");
  };
  await assert.rejects(
    mergeAndPush(run, 999, "ralph/phase-2", {
      resolve: unexpected,
      check: unexpected,
    }),
    /issue-999/,
  );
});
