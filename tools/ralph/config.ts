import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseReviewConfig } from "./review-report.ts";
import type { ReviewConfig } from "./review-report.ts";

export type Config = {
  label: string;
  branch: string;
  maxIterations: number;
  maxFixAttempts: number;
  maxConsecutiveFailures: number;
  maxMinutes?: number;
  maxTokens?: number;
  checks: string[][];
  review: ReviewConfig;
};

export function positiveInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

export function parseOptions() {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      "skip-preflight": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "max-iterations": { type: "string" },
    },
    allowPositionals: false,
  });
  const phase = positiveInteger(values.phase, "--phase");
  const max = values["max-iterations"];
  return {
    phase,
    skipPreflight: values["skip-preflight"],
    dryRun: values["dry-run"],
    max:
      max === undefined ? undefined : positiveInteger(max, "--max-iterations"),
  };
}

export function loadConfig(file: string, phase: number): Config {
  const config = JSON.parse(readFileSync(file, "utf8")) as Config;
  if (
    !config ||
    typeof config.label !== "string" ||
    !config.label.trim() ||
    typeof config.branch !== "string" ||
    !config.branch.trim() ||
    !Array.isArray(config.checks) ||
    !config.checks.length ||
    !config.checks.every(
      (command) =>
        Array.isArray(command) &&
        command.length &&
        command.every((arg) => typeof arg === "string") &&
        command[0].trim(),
    )
  ) {
    throw new Error("Invalid ralph.config.json");
  }
  config.maxIterations = positiveInteger(config.maxIterations, "maxIterations");
  if (typeof config.maxFixAttempts !== "number")
    throw new Error("maxFixAttempts must be a positive integer");
  config.maxFixAttempts = positiveInteger(
    config.maxFixAttempts,
    "maxFixAttempts",
  );
  for (const field of [
    "maxConsecutiveFailures",
    "maxMinutes",
    "maxTokens",
  ] as const) {
    const value =
      config[field] === undefined && field === "maxConsecutiveFailures"
        ? 2
        : config[field];
    if (value === undefined) continue;
    if (typeof value !== "number")
      throw new Error(`${field} must be a positive integer`);
    config[field] = positiveInteger(value, field);
  }
  config.review = parseReviewConfig(config.review);
  config.label = config.label.replaceAll("{phase}", String(phase));
  config.branch = config.branch.replaceAll("{phase}", String(phase));
  if (config.branch === "main") throw new Error("Phase branch cannot be main");
  return config;
}
