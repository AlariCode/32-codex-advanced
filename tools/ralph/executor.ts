import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentCommandError,
  readThreadId,
  runAgent,
  resumeAgent,
} from "./agent.ts";
import { renderPrompt, renderFixPrompt } from "./prompts.ts";
import type { CommandRunner } from "./exec.ts";
import type { Task } from "./tasks.ts";

export type Feedback = { kind: "check" | "review"; text: string };
export type ExecutorOptions = {
  run: CommandRunner;
  directory: string;
  log: string;
  task: Task;
  template: string;
  fixTemplate: string;
};

export function createExecutor(options: ExecutorOptions) {
  const { run, directory, log, task, template, fixTemplate } = options;
  let attempt = 0;
  let threadId: string | undefined;
  const record = (outcome: string) =>
    appendFileSync(
      log,
      `issue=${task.number} attempt=${attempt} thread_id=${threadId ?? "none"} check=${outcome}\n`,
    );
  const invoke = async (resume: boolean, feedback?: Feedback) => {
    attempt++;
    writeFileSync(join(directory, `check-${attempt}.log`), "");
    const fixPrompt = feedback
      ? renderFixPrompt(
          fixTemplate,
          task.number,
          feedback.kind === "check" ? feedback.text : "",
          feedback.kind === "review" ? feedback.text : "",
        )
      : "";
    try {
      const result = resume
        ? await resumeAgent(run, directory, threadId!, fixPrompt, attempt)
        : await runAgent(
            run,
            directory,
            renderPrompt(template, task) +
              (fixPrompt ? `\n\n${fixPrompt}` : ""),
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
  return {
    get attempt() {
      return attempt;
    },
    record,
    async execute(fix: number, feedback?: Feedback) {
      if (fix === 0) return invoke(false);
      if (threadId) {
        try {
          return await invoke(true, feedback);
        } catch (error) {
          if (!(error instanceof AgentCommandError)) throw error;
          appendFileSync(
            log,
            `issue=${task.number} fix=${fix} fallback: resume failed: ${error.message}\n`,
          );
        }
      } else
        appendFileSync(
          log,
          `issue=${task.number} fix=${fix} fallback: thread_id not found\n`,
        );
      threadId = undefined;
      return invoke(false, feedback);
    },
  };
}
