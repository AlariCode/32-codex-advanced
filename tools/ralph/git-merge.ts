import type { CommandRunner } from "./exec.ts";
import { assertClean } from "./git.ts";

export async function mergeAndPush(
  run: CommandRunner,
  number: number,
  phase: string,
  recovery: {
    resolve: (files: string[]) => Promise<void>;
    check: () => Promise<boolean>;
  },
) {
  await assertClean(run);
  await run(["git", "switch", phase]);
  const head = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
  const source = (
    await run(["git", "rev-parse", `issue-${number}`])
  ).stdout.trim();
  const merge = await run(
    ["git", "merge", "--no-ff", "--no-edit", `issue-${number}`],
    { allowFailure: true },
  );
  if (merge.code !== 0) {
    const conflicts = (
      await run(["git", "diff", "--name-only", "--diff-filter=U", "-z"])
    ).stdout
      .split("\0")
      .filter(Boolean);
    if (!conflicts.length) {
      throw new Error(
        `Merge issue-${number} failed: ${merge.stderr || merge.stdout}`,
      );
    }
    const assertMerge = async () => {
      const branch = (
        await run(["git", "branch", "--show-current"])
      ).stdout.trim();
      const current = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
      const merging = await run(
        ["git", "rev-parse", "--verify", "MERGE_HEAD"],
        { allowFailure: true },
      );
      if (
        branch !== phase ||
        current !== head ||
        merging.code !== 0 ||
        merging.stdout.trim() !== source
      ) {
        throw new Error(
          `Expected pending merge of issue-${number} into ${phase}`,
        );
      }
    };
    await assertMerge();
    await recovery.resolve(conflicts);
    await assertMerge();
    await run(["git", "diff", "--check"]);
    await run(["git", "add", "--", ...conflicts]);
    if (
      (await run(["git", "diff", "--name-only", "--diff-filter=U", "-z"]))
        .stdout
    ) {
      throw new Error("Merge still has unresolved conflicts");
    }
    await run(["git", "diff", "--cached", "--check"]);
    if (!(await recovery.check()))
      throw new Error("Merge resolution checks failed");
    await assertMerge();
    await run(["git", "diff", "--exit-code"]);
    await run(["git", "commit", "--no-edit"]);
  }
  await assertClean(run);
  await run(["git", "push", "-u", "origin", phase]);
}
