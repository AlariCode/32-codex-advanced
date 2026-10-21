import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import { assertClean } from "./git.ts";
import { runChecks } from "./checks.ts";

export async function preflight(
  run: CommandRunner,
  checks: string[][],
  directory: string,
) {
  await assertClean(run);
  const log = join(directory, "preflight.log");
  writeFileSync(log, "");
  const green = await runChecks(run, checks, log, { requireChanges: false });
  if (green) await assertClean(run);
  return green;
}
