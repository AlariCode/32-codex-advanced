import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import type { Task } from "./tasks.ts";
import { parseReport, writeReportSchema } from "./report.ts";

export function renderPrompt(
  template: string,
  task: Task,
  diagnostics = "",
): string {
  const values: Record<string, string> = {
    number: String(task.number),
    title: task.title,
    body: task.body,
  };
  const prompt = template.replace(
    /{{(number|title|body)}}/g,
    (_, key) => values[key],
  );
  return diagnostics
    ? `${prompt}\n\nПоследняя внешняя проверка (80 строк):\n${diagnostics}\n`
    : prompt;
}

export async function runAgent(
  run: CommandRunner,
  directory: string,
  prompt: string,
) {
  const schema = join(directory, "report.schema.json");
  const report = join(directory, "report.json");
  const events = join(directory, "events.jsonl");
  writeFileSync(join(directory, "prompt.md"), prompt);
  writeFileSync(events, "");
  writeFileSync(report, "");
  writeFileSync(join(directory, "agent.log"), "");
  writeReportSchema(schema);
  const cache = (await run(["go", "env", "GOCACHE"])).stdout.trim();
  if (!cache) throw new Error("go env GOCACHE returned an empty path");
  await run(
    [
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
      "--json",
      "--output-schema",
      schema,
      "-o",
      report,
      "--add-dir",
      cache,
      "-",
    ],
    {
      input: prompt,
      stdoutFile: events,
      stderrFile: join(directory, "agent.log"),
    },
  );
  return parseReport(readFileSync(report, "utf8"));
}
