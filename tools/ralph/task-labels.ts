import type { CommandRunner } from "./exec.ts";
import { commentTask } from "./tasks.ts";

export async function markBlocked(
  run: CommandRunner,
  number: number,
  summary: string,
) {
  return markLabel(run, number, summary, "blocked");
}

export function markFailed(
  run: CommandRunner,
  number: number,
  summary: string,
) {
  return markLabel(run, number, summary, "ralph-failed");
}

async function markLabel(
  run: CommandRunner,
  number: number,
  summary: string,
  name: string,
) {
  const result = await run([
    "gh",
    "label",
    "list",
    "--search",
    name,
    "--limit",
    "10000",
    "--json",
    "name",
  ]);
  // gh label list can exit successfully with no output when no labels match.
  const labels: { name: string }[] = JSON.parse(result.stdout.trim() || "[]");
  if (!labels.some((label) => label.name.toLowerCase() === name)) {
    await run([
      "gh",
      "label",
      "create",
      name,
      "--color",
      "D93F0B",
      "--description",
      name === "blocked"
        ? "Task cannot proceed until a blocker is resolved"
        : "Ralph failed; human review required",
    ]);
  }
  await run(["gh", "issue", "edit", String(number), "--add-label", name]);
  await commentTask(run, number, summary);
}
