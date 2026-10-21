import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent } from "./agent.ts";
import { renderMergePrompt } from "./prompts.ts";
import { runChecks, tailCheckLog } from "./checks.ts";
import { mergeAndPush } from "./git.ts";
import type { CommandRunner } from "./exec.ts";

export async function mergeTask(
  run: CommandRunner,
  number: number,
  phase: string,
  artifacts: string,
  log: string,
  checks: string[][],
) {
  const directory = join(artifacts, "merge");
  await mergeAndPush(run, number, phase, {
    resolve: async (files) => {
      mkdirSync(directory, { recursive: true });
      const { report, threadId } = await runAgent(
        run,
        directory,
        renderMergePrompt(number, phase, files),
      );
      appendFileSync(
        log,
        `issue=${number} merge attempt=1 thread_id=${threadId ?? "none"} agent=${report.status}\n`,
      );
      if (report.status !== "done")
        throw new Error(`Merge resolver ${report.status}: ${report.summary}`);
    },
    check: async () => {
      const checkLog = join(directory, "check-1.log");
      writeFileSync(checkLog, "");
      const green = await runChecks(run, checks, checkLog, {
        requireChanges: false,
      });
      if (!green) appendFileSync(log, tailCheckLog(checkLog) + "\n");
      return green;
    },
  });
}
