import type { CommandRunner } from "./exec.ts";
import { phaseHasCommits } from "./git.ts";

export async function ensurePhasePR(
  run: CommandRunner,
  branch: string,
  body: string,
) {
  const result = await run([
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--base",
    "main",
    "--state",
    "open",
    "--json",
    "number",
  ]);
  const existing = JSON.parse(result.stdout);
  if (existing.length) {
    await run(
      ["gh", "pr", "comment", String(existing[0].number), "--body-file", "-"],
      { input: body },
    );
    return;
  }
  if (!(await phaseHasCommits(run, branch))) return;
  await run(
    [
      "gh",
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      "main",
      "--title",
      `Ralph: ${branch}`,
      "--body-file",
      "-",
    ],
    { input: body },
  );
}
