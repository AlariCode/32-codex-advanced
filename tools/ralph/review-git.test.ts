import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "./git-test-helpers.ts";
import { createReviewStep } from "./review-step.ts";
import type { CommandRunner } from "./exec.ts";

test("review snapshot includes untracked files and exactly matches the staged Git diff", async (t) => {
  const { directory, run: git } = await repository(t);
  writeFileSync(join(directory, ".gitignore"), ".ralph/\n");
  writeFileSync(join(directory, "source.ts"), "const value = 1;\n");
  await git(["git", "add", "-A"]);
  await git(["git", "commit", "-m", "Base"]);
  writeFileSync(join(directory, "source.ts"), "const value = 2;\n");
  writeFileSync(join(directory, "new.ts"), "export const added = true;\n");
  const artifacts = join(directory, ".ralph", "issue-8");
  mkdirSync(artifacts, { recursive: true });
  let calls = 0;
  const run: CommandRunner = async (command, options) => {
    if (command[0] === "gh") return { code: 0, stdout: "", stderr: "" };
    if (command[0] !== "codex") return git(command, options);
    calls++;
    const diff = readFileSync(join(artifacts, "review-1.diff"), "utf8");
    assert.equal(
      diff,
      (await git(["git", "diff", "--cached", "--no-color"])).stdout,
    );
    assert.match(diff, /new.ts/);
    assert.match(diff, /\+const value = 2/);
    assert.doesNotMatch(diff, /review.schema.json|review-1.json/);
    assert.ok(options?.input?.includes("Full acceptance criteria"));
    writeFileSync(
      command[command.indexOf("-o") + 1],
      JSON.stringify({ summary: "", criteria: [], findings: [] }),
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const step = createReviewStep({
    run,
    directory: artifacts,
    log: join(artifacts, "run.log"),
    task: {
      number: 8,
      title: "Task",
      body: "Full acceptance criteria",
      labels: [],
    },
    template: readFileSync(
      new URL("./ralph-review.md", import.meta.url),
      "utf8",
    ),
    config: { enabled: true, blockingPriorities: [0, 1] },
  });
  assert.equal((await step()).blocking, false);
  assert.equal(calls, 1);
  assert.match(
    (await git(["git", "status", "--porcelain"])).stdout,
    /A  new.ts/,
  );
});
