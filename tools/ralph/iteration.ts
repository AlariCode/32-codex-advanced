import { join } from "node:path";
import { createExecutor } from "./executor.ts";
import type { ExecutorOptions, Feedback } from "./executor.ts";
import { runChecks, tailCheckLog } from "./checks.ts";
import { TaskFailure, noProgress } from "./run-state.ts";
import { commitTask, diffHash } from "./git.ts";
import { createReviewStep } from "./review-step.ts";
import type { Finding, ReviewConfig } from "./review-report.ts";

type Options = ExecutorOptions & {
  checks: string[][];
  maxFixAttempts: number;
  review?: ReviewConfig;
  reviewTemplate?: string;
  onReturn?: (kind: "check" | "review") => void;
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
  let previousHash: string | undefined;
  let feedback: Feedback | undefined;
  for (let fix = 0; fix <= maxFixAttempts; fix++) {
    const report = await executor.execute(fix, feedback);
    if (report.status !== "done") {
      executor.record(`not-run ${report.status}`);
      return {
        report:
          report.status === "failed" && feedback
            ? { ...report, summary: `${report.summary}\n${feedback.text}` }
            : report,
        nonBlocking: [] as Finding[],
      };
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
      throw new TaskFailure(
        `Fix attempts exhausted for #${task.number} (${maxFixAttempts})\n${report.summary}\n${feedback.text}`,
      );
    }
    const hash = await diffHash(run);
    if (noProgress(previousHash, hash))
      throw new TaskFailure(`нет прогресса\n${feedback.text}`);
    previousHash = hash;
    options.onReturn?.(feedback.kind);
  }
  throw new Error("Unreachable attempt state");
}
