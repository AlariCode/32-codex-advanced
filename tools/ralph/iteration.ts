import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentCommandError,
  readThreadId,
  runAgent,
  resumeAgent,
} from "./agent.ts";
import { renderPrompt, renderFixPrompt } from "./prompts.ts";
import { runChecks, tailCheckLog } from "./checks.ts";
import { commitTask } from "./git.ts";
import type { CommandRunner } from "./exec.ts";
import type { Task } from "./tasks.ts";

type Options = {
  run: CommandRunner;
  directory: string;
  log: string;
  task: Task;
  template: string;
  fixTemplate: string;
  checks: string[][];
  maxFixAttempts: number;
};

export async function runTaskAttempts(options: Options) {
  const {
    run,
    directory,
    log,
    task,
    template,
    fixTemplate,
    checks,
    maxFixAttempts,
  } = options;
  let attempt = 0;
  let threadId: string | undefined;
  let diagnostics = "";
  const record = (outcome: string) =>
    appendFileSync(
      log,
      `issue=${task.number} attempt=${attempt} thread_id=${threadId ?? "none"} check=${outcome}\n`,
    );
  const invoke = async (resume: boolean) => {
    attempt++;
    writeFileSync(join(directory, `check-${attempt}.log`), "");
    try {
      const result = resume
        ? await resumeAgent(
            run,
            directory,
            threadId!,
            renderFixPrompt(fixTemplate, task.number, diagnostics),
            attempt,
          )
        : await runAgent(
            run,
            directory,
            renderPrompt(template, task, diagnostics),
            attempt,
          );
      threadId = result.threadId;
      return result.report;
    } catch (error) {
      const events = join(directory, `events-${attempt}.jsonl`);
      if (existsSync(events)) threadId = readThreadId(events) ?? threadId;
      record("not-run agent-error");
      throw error;
    }
  };
  for (let fix = 0; fix <= maxFixAttempts; fix++) {
    let report;
    if (fix === 0) report = await invoke(false);
    else {
      let fallback = !threadId;
      if (fallback)
        appendFileSync(
          log,
          `issue=${task.number} fix=${fix} fallback: thread_id not found\n`,
        );
      else {
        try {
          report = await invoke(true);
        } catch (error) {
          if (!(error instanceof AgentCommandError)) throw error;
          appendFileSync(
            log,
            `issue=${task.number} fix=${fix} fallback: resume failed: ${error.message}\n`,
          );
          fallback = true;
        }
      }
      if (fallback) {
        threadId = undefined;
        report = await invoke(false);
      }
    }
    if (!report) throw new Error("Agent returned no report");
    if (report.status !== "done") {
      record(`not-run ${report.status}`);
      return report;
    }
    const checkLog = join(directory, `check-${attempt}.log`);
    let green: boolean;
    try {
      green = await runChecks(run, checks, checkLog);
      if (green) green = await commitTask(run, report.commit_message, checkLog);
    } catch (error) {
      record("error");
      throw error;
    }
    record(green ? "green" : "red");
    if (green) return report;
    diagnostics = tailCheckLog(checkLog);
    if (fix === maxFixAttempts) {
      throw new Error(
        `Fix attempts exhausted for #${task.number} (${maxFixAttempts})\n${report.summary}\n${diagnostics}`,
      );
    }
  }
  throw new Error("Unreachable attempt state");
}
