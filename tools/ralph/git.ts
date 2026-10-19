import type { CommandRunner } from "./exec.ts";

export async function hasChanges(run: CommandRunner): Promise<boolean> {
  return Boolean((await run(["git", "status", "--porcelain"])).stdout.trim());
}

export async function assertClean(run: CommandRunner): Promise<void> {
  if (await hasChanges(run)) throw new Error("Working tree must be clean");
}

export async function ensurePhaseBranch(run: CommandRunner, branch: string) {
  await assertClean(run);
  await run(["git", "check-ref-format", "--branch", branch]);
  await run(["git", "fetch", "origin"]);
  const local = await run(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { allowFailure: true },
  );
  const remote = await run(
    ["git", "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
    { allowFailure: true },
  );
  if (local.code === 0) {
    await run(["git", "switch", branch]);
    if (remote.code === 0)
      await run(["git", "merge", "--ff-only", `origin/${branch}`]);
  } else if (remote.code === 0) {
    await run(["git", "switch", "--track", "-c", branch, `origin/${branch}`]);
  } else {
    await run(["git", "switch", "-c", branch, "origin/main"]);
    await run(["git", "push", "-u", "origin", branch]);
  }
}

export async function startTaskBranch(
  run: CommandRunner,
  number: number,
  phase: string,
) {
  await assertClean(run);
  const branch = `issue-${number}`;
  const local = await run(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { allowFailure: true },
  );
  if (local.code === 0) {
    await run(["git", "switch", branch]);
  } else if (local.code === 1) {
    await run(["git", "switch", "-c", branch, phase]);
  } else {
    throw new Error(
      `Could not check task branch ${branch}: ${local.stderr || local.stdout}`,
    );
  }
}

export async function commitTask(
  run: CommandRunner,
  message: string,
  log: string,
): Promise<boolean> {
  await run(["git", "add", "-A"]);
  const result = await run(["git", "commit", "-m", message], {
    stdoutFile: log,
    stderrFile: log,
    allowFailure: true,
  });
  return result.code === 0;
}

export { mergeAndPush } from "./git-merge.ts";

export async function parkBlockedChanges(
  run: CommandRunner,
  phase: string,
  number: number,
) {
  let stash = "";
  if (await hasChanges(run)) {
    await run([
      "git",
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `ralph blocked #${number}`,
    ]);
    stash = (await run(["git", "rev-parse", "stash@{0}"])).stdout.trim();
  }
  await run(["git", "switch", phase]);
  return stash;
}

export async function phaseHasCommits(
  run: CommandRunner,
  branch: string,
): Promise<boolean> {
  return Boolean(
    (
      await run(["git", "log", "--oneline", `origin/main..${branch}`])
    ).stdout.trim(),
  );
}
