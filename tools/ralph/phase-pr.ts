import type { CommandRunner } from "./exec.ts";
import { phaseHasCommits } from "./git.ts";

export async function ensurePhasePR(
  run: CommandRunner,
  branch: string,
  closed: number[],
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
  if (JSON.parse(result.stdout).length) return;
  if (!(await phaseHasCommits(run, branch))) return;
  const body = `Closed tasks in this run:\n\n${closed.map((number) => `- #${number}`).join("\n") || "None."}`;
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
