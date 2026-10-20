import { join } from "node:path";
import { createExecutor } from "./executor.ts";
import type { ExecutorOptions, Feedback } from "./executor.ts";
import { runChecks, tailCheckLog } from "./checks.ts";
import { commitTask } from "./git.ts";
import { createReviewStep } from "./review-step.ts";
import type { Finding, ReviewConfig } from "./review-report.ts";

type Options = ExecutorOptions & {
  checks: string[][];
  maxFixAttempts: number;
  review?: ReviewConfig;
  reviewTemplate?: string;
};

export async function runTaskAttempts(options: Options) {
  const { run, directory, log, task, checks, maxFixAttempts } = options;
  if (options.review?.enabled && !options.reviewTemplate)
    throw new Error("Missing review template");
  const review = options.review?.enabled
    ? createReviewStep({
        run,
        directory,
        log,
        task,
        config: options.review,
        template: options.reviewTemplate!,
      })
    : undefined;
  const executor = createExecutor(options);
  let feedback: Feedback | undefined;
  for (let fix = 0; fix <= maxFixAttempts; fix++) {
    const report = await executor.execute(fix, feedback);
    if (report.status !== "done") {
      executor.record(`not-run ${report.status}`);
      return { report, nonBlocking: [] as Finding[] };
    }
    const checkLog = join(directory, `check-${executor.attempt}.log`);
    try {
      let green = await runChecks(run, checks, checkLog);
      const reviewed = green && review ? await review() : undefined;
      if (reviewed?.blocking) {
        executor.record("green review=changes");
        feedback = { kind: "review", text: reviewed.feedback };
      } else {
        if (green)
          green = await commitTask(run, report.commit_message, checkLog);
        executor.record(green ? "green" : "red");
        if (green) return { report, nonBlocking: reviewed?.nonBlocking ?? [] };
        feedback = { kind: "check", text: tailCheckLog(checkLog) };
      }
    } catch (error) {
      executor.record("error");
      throw error;
    }
    if (fix === maxFixAttempts) {
      throw new Error(
        `Fix attempts exhausted for #${task.number} (${maxFixAttempts})\n${report.summary}\n${feedback.text}`,
      );
    }
  }
  throw new Error("Unreachable attempt state");
}
