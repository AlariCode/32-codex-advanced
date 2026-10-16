import { appendFileSync, readFileSync } from "node:fs";
import type { CommandRunner } from "./exec.ts";
import { formatCommand } from "./exec.ts";
import { hasChanges } from "./git.ts";

export async function runChecks(
  run: CommandRunner,
  commands: string[][],
  log: string,
): Promise<boolean> {
  let green = await hasChanges(run);
  appendFileSync(log, `\nWorking copy has changes: ${green}\n`);
  for (const command of commands) {
    appendFileSync(log, `\n$ ${formatCommand(command)}\n`);
    const result = await run(command, {
      stdoutFile: log,
      stderrFile: log,
      allowFailure: true,
    });
    appendFileSync(log, `\nexit=${result.code}\n${result.stderr}`);
    if (result.code !== 0) green = false;
  }
  return green;
}

export function tailCheckLog(log: string): string {
  return readFileSync(log, "utf8").trimEnd().split("\n").slice(-80).join("\n");
}
