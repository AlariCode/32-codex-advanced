import { writeFileSync } from "node:fs";

export type AgentReport = {
  status: "done" | "blocked" | "failed";
  summary: string;
  commit_message: string;
};

export const reportSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "blocked", "failed"] },
    summary: { type: "string" },
    commit_message: { type: "string" },
  },
  required: ["status", "summary", "commit_message"],
  additionalProperties: false,
};

export function writeReportSchema(file: string): void {
  writeFileSync(file, JSON.stringify(reportSchema, null, 2));
}

export function parseReport(text: string): AgentReport {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent report must be an object");
  }
  const report = value as Record<string, unknown>;
  if (
    Object.keys(report).length !== 3 ||
    !["done", "blocked", "failed"].includes(String(report.status)) ||
    typeof report.status !== "string" ||
    typeof report.summary !== "string" ||
    typeof report.commit_message !== "string"
  )
    throw new Error("Invalid agent report");
  return report as AgentReport;
}
