import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import type { Task } from "./tasks.ts";
import type { Finding, ReviewConfig, ReviewReport } from "./review-report.ts";
import { runReview, verdict } from "./review.ts";
import { renderReviewPrompt } from "./prompts.ts";

export function formatFindings(findings: Finding[]): string {
  return findings
    .map(
      (item) =>
        `- P${item.priority} ${item.title} (${item.file}:${item.line}): ${item.body}`,
    )
    .join("\n");
}

export function closingSummary(summary: string, findings: Finding[]): string {
  return findings.length
    ? `${summary}\n\nНеблокирующие замечания ревью:\n${formatFindings(findings)}`
    : summary;
}

export function reviewFeedback(
  report: ReviewReport,
  config: ReviewConfig,
): string {
  const criteria = report.criteria
    .filter((item) => !item.met)
    .map((item) => `- ${item.criterion}: ${item.evidence}`)
    .join("\n");
  const findings = formatFindings(
    report.findings.filter((item) =>
      config.blockingPriorities.includes(item.priority),
    ),
  );
  return `Невыполненные критерии:\n${criteria || "Нет"}\n\nБлокирующие находки:\n${findings || "Нет"}`;
}

export function createReviewStep(options: {
  run: CommandRunner;
  directory: string;
  log: string;
  task: Task;
  template: string;
  config: ReviewConfig;
}) {
  const { run, directory, log, task, template, config } = options;
  let round = 0;
  let previous: ReviewReport | undefined;
  return async () => {
    round++;
    await run(["git", "add", "-A"]);
    const diff = join(directory, `review-${round}.diff`);
    writeFileSync(diff, "");
    await run(["git", "diff", "--cached", "--no-color"], { stdoutFile: diff });
    const prompt = renderReviewPrompt(template, task, diff, previous);
    let report: ReviewReport | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        report = await runReview(
          run,
          directory,
          prompt,
          `review-${round}${attempt ? "-retry" : ""}`,
        );
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendFileSync(
          log,
          `issue=${task.number} review=${round} attempt=${attempt + 1} error=${JSON.stringify(message)}\n`,
        );
        if (attempt)
          throw new Error(
            `Review failed twice for #${task.number}: ${message}`,
          );
      }
    }
    if (!report) throw new Error("Reviewer returned no report");
    previous = report;
    const result = verdict(report, config.blockingPriorities);
    const counts = [0, 1, 2, 3]
      .map(
        (p) =>
          `P${p}=${report.findings.filter((f) => f.priority === p).length}`,
      )
      .join(" ");
    const unmet = report.criteria
      .filter((item) => !item.met)
      .map((item) => item.criterion);
    appendFileSync(
      log,
      `issue=${task.number} review=${round} ${counts} unmet=${JSON.stringify(unmet)} verdict=${result.blocking ? "changes" : "approve"}\n`,
    );
    return { ...result, feedback: reviewFeedback(report, config) };
  };
}
