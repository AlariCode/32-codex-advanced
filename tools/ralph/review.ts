import { parseUsage } from "./summary.ts";
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
) {
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
  return {
    report: parseReviewReport(readFileSync(report, "utf8")),
    usage: parseUsage(readFileSync(events, "utf8")),
  };
}

export function renderReviewComment(
  report: ReviewReport,
  round: number,
  result: { blocking: boolean; previous?: ReviewReport },
): string {
  const line = (text: string) => text.replace(/\s+/g, " ").trim();
  const findings = [...report.findings]
    .sort((a, b) => a.priority - b.priority)
    .map(
      (f) =>
        `- P${f.priority} \`${f.file}:${f.line}\` — ${f.title}\n  ${f.body}`,
    )
    .join("\n");
  const previous = result.previous;
  const history = previous
    ? [
        ...previous.criteria
          .filter((c) => !c.met)
          .map((c) => {
            const current = report.criteria.find(
              (item) => item.criterion === c.criterion,
            );
            return `- ${c.criterion}: ${current?.met ? "исправлено" : current ? "не исправлено" : "повторно не подтверждено"}`;
          }),
        ...previous.findings.map((f) => {
          const remains = report.findings.some(
            (item) => item.file === f.file && item.title === f.title,
          );
          return `- ${f.file}: ${f.title}: ${remains ? "не исправлено" : "исправлено (по повторному ревью)"}`;
        }),
      ].join("\n")
    : "";
  return `## Ревью, раунд ${round}: ${result.blocking ? "changes" : "approve"}

${report.summary}

Критерии готовности:
${report.criteria.map((c) => `- ${c.met ? "✅" : "❌"} ${line(c.criterion)} — ${line(c.evidence)}`).join("\n") || "Нет."}

Находки:
${findings || "Нет."}
${history ? `\nЗамечания прошлого раунда:\n${history}\n` : ""}
${result.blocking ? "возвращено исполнителю" : "принято, вливается в ветку фазы"}`;
}
