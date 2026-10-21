import { writeFileSync } from "node:fs";
import type { AgentReport } from "./report.ts";
import type { ReviewReport } from "./review-report.ts";

export type Step = {
  threadId?: string;
  status?: AgentReport["status"];
  code?: number;
  malformed?: boolean;
};
export type ReviewerStep = {
  code?: number;
  report?: ReviewReport;
  malformed?: boolean;
};
export const approved: ReviewReport = {
  summary: "Reviewed",
  criteria: [],
  findings: [],
};

export function createFakeCodex(
  agents: Step[] = [],
  reviewers: ReviewerStep[] = [],
) {
  let agent = 0;
  let review = 0;
  return (command: string[]) => {
    const readonly = command.includes("read-only");
    const step = readonly
      ? (reviewers[review++] ?? {})
      : (agents[agent++] ?? { threadId: "thread-1" });
    const code = step.code ?? 0;
    const report = readonly
      ? ((step as ReviewerStep).report ?? approved)
      : {
          status: (step as Step).status ?? "done",
          summary: `agent-${agent}`,
          commit_message: "Task commit",
        };
    writeFileSync(
      command[command.indexOf("-o") + 1],
      step.malformed ? "broken" : JSON.stringify(report),
    );
    const threadId = !readonly ? (step as Step).threadId : undefined;
    return {
      code,
      stdout:
        JSON.stringify(
          threadId
            ? { type: "thread.started", thread_id: threadId }
            : { type: "turn.completed" },
        ) +
        "\n" +
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 },
        }) +
        "\n",
      stderr: code
        ? readonly
          ? "reviewer unavailable"
          : "no rollout found"
        : "",
    };
  };
}
