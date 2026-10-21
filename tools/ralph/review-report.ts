export type Priority = 0 | 1 | 2 | 3;
export type Finding = {
  priority: Priority;
  title: string;
  body: string;
  file: string;
  line: number;
};
export type Criterion = { criterion: string; met: boolean; evidence: string };
export type ReviewReport = {
  summary: string;
  criteria: Criterion[];
  findings: Finding[];
};
export type ReviewConfig = { enabled: boolean; blockingPriorities: Priority[] };

export const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "criteria", "findings"],
  properties: {
    summary: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "met", "evidence"],
        properties: {
          criterion: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "title", "body", "file", "line"],
        properties: {
          priority: { type: "integer", enum: [0, 1, 2, 3] },
          title: { type: "string" },
          body: { type: "string" },
          file: { type: "string" },
          line: { type: "integer" },
        },
      },
    },
  },
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error("Invalid review report object");
  }
  return value as Record<string, unknown>;
}

export function parseReviewReport(text: string): ReviewReport {
  const report = object(JSON.parse(text), ["summary", "criteria", "findings"]);
  if (
    typeof report.summary !== "string" ||
    !Array.isArray(report.criteria) ||
    !Array.isArray(report.findings)
  ) {
    throw new Error("Invalid review report");
  }
  for (const value of report.criteria) {
    const item = object(value, ["criterion", "met", "evidence"]);
    if (
      typeof item.criterion !== "string" ||
      typeof item.met !== "boolean" ||
      typeof item.evidence !== "string"
    ) {
      throw new Error("Invalid review criterion");
    }
  }
  for (const value of report.findings) {
    const item = object(value, ["priority", "title", "body", "file", "line"]);
    if (
      !Number.isInteger(item.priority) ||
      ![0, 1, 2, 3].includes(item.priority as number) ||
      ![item.title, item.body, item.file].every(
        (field) => typeof field === "string",
      ) ||
      !Number.isInteger(item.line)
    ) {
      throw new Error("Invalid review finding");
    }
  }
  return report as ReviewReport;
}

export function parseReviewConfig(value: unknown): ReviewConfig {
  if (value === undefined)
    return { enabled: false, blockingPriorities: [0, 1] };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid review config");
  const config = value as Record<string, unknown>;
  if (
    typeof config.enabled !== "boolean" ||
    !Array.isArray(config.blockingPriorities) ||
    !config.blockingPriorities.every(
      (p) => Number.isInteger(p) && [0, 1, 2, 3].includes(p),
    )
  ) {
    throw new Error("Invalid review config");
  }
  return {
    enabled: config.enabled,
    blockingPriorities: config.blockingPriorities as Priority[],
  };
}
