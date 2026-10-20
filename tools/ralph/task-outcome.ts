import { appendFileSync } from "node:fs";
import type { CommandRunner } from "./exec.ts";
import { parkBlockedChanges, parkFailedChanges } from "./git.ts";
import { markBlocked, markFailed } from "./tasks.ts";
import type { RunSummary } from "./summary.ts";

export async function parkTask(
  run: CommandRunner,
  branch: string,
  number: number,
  status: "blocked" | "failed",
  reason: string,
  log: string,
  state: RunSummary,
) {
  const stash = await (
    status === "blocked" ? parkBlockedChanges : parkFailedChanges
  )(run, branch, number);
  state[status].push({ number, reason: reason.split(/\r?\n/)[0] });
  appendFileSync(
    log,
    `${status} #${number} stash=${stash || "none"} ${reason}\n`,
  );
  const body = `${reason}\n\n${stash ? `Сохранённые изменения: git stash apply ${stash}` : "Изменений для stash нет."}`;
  await (status === "blocked" ? markBlocked : markFailed)(run, number, body);
}
