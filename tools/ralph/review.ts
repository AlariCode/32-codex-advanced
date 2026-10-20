import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import { parseReviewReport, reviewSchema } from "./review-report.ts";
import type { Priority, ReviewReport } from "./review-report.ts";

export function reviewArgs(schema: string, report: string): string[] {
  return [
    "exec",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--json",
    "--output-schema",
    schema,
    "-o",
    report,
    "-",
  ];
}

export function verdict(report: ReviewReport, blockingPriorities: Priority[]) {
  return {
    blocking:
      report.criteria.some((item) => !item.met) ||
      report.findings.some((item) =>
        blockingPriorities.includes(item.priority),
      ),
    nonBlocking: report.findings.filter(
      (item) => !blockingPriorities.includes(item.priority),
    ),
  };
}

export async function runReview(
  run: CommandRunner,
  directory: string,
  prompt: string,
  stem: string,
): Promise<ReviewReport> {
  const schema = join(directory, "review.schema.json");
  const report = join(directory, `${stem}.json`);
  const events = join(directory, `${stem}.jsonl`);
  const log = join(directory, `${stem}.log`);
  writeFileSync(schema, JSON.stringify(reviewSchema, null, 2));
  writeFileSync(join(directory, `${stem}.md`), prompt);
  for (const file of [report, events, log]) writeFileSync(file, "");
  const result = await run(["codex", ...reviewArgs(schema, report)], {
    input: prompt,
    stdoutFile: events,
    stderrFile: log,
    allowFailure: true,
  });
  if (result.code !== 0)
    throw new Error(
      `Reviewer exit=${result.code}: ${readFileSync(log, "utf8").trim()}`,
    );
  return parseReviewReport(readFileSync(report, "utf8"));
}
