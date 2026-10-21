import type { TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner } from "./exec.ts";

export async function repository(t: TestContext) {
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

export async function mergeRepository(t: TestContext, conflict = true) {
  const repo = await repository(t);
  const { directory, run } = repo;
  const remote = join(directory, "remote.git");
  await run(["git", "init", "--bare", remote]);
  await run(["git", "remote", "add", "origin", remote]);
  await writeFile(join(directory, ".gitignore"), "remote.git/\n");
  await writeFile(join(directory, "progress.md"), "History\n");
  await run(["git", "add", "."]);
  await run(["git", "commit", "-m", "Base"]);
  await run(["git", "switch", "-c", "issue-8"]);
  await writeFile(join(directory, "progress.md"), "History\nTask entry\n");
  await run(["git", "commit", "-am", "Task"]);
  await run(["git", "switch", "ralph/phase-2"]);
  if (conflict) {
    await writeFile(join(directory, "progress.md"), "History\nPhase entry\n");
    await run(["git", "commit", "-am", "Phase"]);
  }
  await run(["git", "push", "-u", "origin", "ralph/phase-2"]);
  const before = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
  await run(["git", "switch", "issue-8"]);
  return { ...repo, remote, before };
}
