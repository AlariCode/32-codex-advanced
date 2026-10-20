import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Usage = { input: number; cached: number; output: number };
export function parseUsage(text: string): Usage {
  const total = { input: 0, cached: 0, output: 0 };
  for (const line of text.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "turn.completed" || !event.usage) continue;
      for (const [key, field] of Object.entries({
        input: "input_tokens",
        cached: "cached_input_tokens",
        output: "output_tokens",
      })) {
        const value = event.usage[field];
        if (Number.isSafeInteger(value) && value >= 0)
          total[key as keyof Usage] += value;
      }
    } catch {
      /* Partial or malformed event. */
    }
  }
  return total;
}
export function collectUsage(directory: string): Usage {
  const total = { input: 0, cached: 0, output: 0 };
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const usage = entry.isDirectory()
      ? collectUsage(path)
      : entry.name.endsWith(".jsonl")
        ? parseUsage(readFileSync(path, "utf8"))
        : undefined;
    if (usage)
      for (const key of ["input", "cached", "output"] as const)
        total[key] += usage[key];
  }
  return total;
}
export type StopReason =
  | "задачи кончились"
  | "лимит итераций"
  | "maxMinutes"
  | "maxTokens"
  | "предохранитель"
  | "preflight"
  | "ошибка раннера";
export type RunSummary = {
  phase: string;
  started: number;
  ended: number;
  usage: Usage;
  closed: number[];
  blocked: { number: number; reason: string }[];
  failed: { number: number; reason: string }[];
  returns: { check: number; review: number };
  reason: StopReason;
  detail?: string;
};
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export function renderSummary(state: RunSummary): string {
  const issues = (items: { number: number; reason: string }[]) =>
    items
      .map((item) => `- #${item.number}: ${oneLine(item.reason)}`)
      .join("\n") || "Нет.";
  return `# Ralph: ${state.phase}

Начало: ${new Date(state.started).toISOString()}
Окончание: ${new Date(state.ended).toISOString()}
Время прогона: ${((state.ended - state.started) / 60000).toFixed(2)} мин.
Токены: вход ${state.usage.input}, кэш ${state.usage.cached}, выход ${state.usage.output}; сумма ${state.usage.input + state.usage.output}.

## Закрытые задачи

${state.closed.map((number) => `- #${number}`).join("\n") || "Нет."}

## Blocked

${issues(state.blocked)}

## Ralph-failed

${issues(state.failed)}

Возвраты: от проверок ${state.returns.check}, от ревью ${state.returns.review}.
Причина остановки: ${state.reason}${state.detail ? ` — ${oneLine(state.detail)}` : ""}.
`;
}
