import type { Config } from "./config.ts";
import type { Usage, StopReason } from "./summary.ts";

export function failureStreak(previous: number, status: string): number {
  return status === "failed" ? previous + 1 : status === "done" ? 0 : previous;
}
export function budgetStop(
  config: Pick<Config, "maxMinutes" | "maxTokens">,
  started: number,
  usage: Usage,
  now = Date.now(),
): StopReason | undefined {
  if (
    config.maxMinutes !== undefined &&
    now - started >= config.maxMinutes * 60000
  )
    return "maxMinutes";
  if (
    config.maxTokens !== undefined &&
    usage.input + usage.output >= config.maxTokens
  )
    return "maxTokens";
}
export function noProgress(
  previous: string | undefined,
  current: string,
): boolean {
  return previous !== undefined && previous === current;
}
export class TaskFailure extends Error {}
