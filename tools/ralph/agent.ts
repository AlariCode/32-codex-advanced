import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./exec.ts";
import { parseReport, writeReportSchema } from "./report.ts";

export class AgentCommandError extends Error {}

export function codexArgs({
  schema,
  report,
  cache,
  threadId,
}: {
  schema: string;
  report: string;
  cache: string;
  threadId?: string;
}): string[] {
  return [
    "exec",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    cache,
    "--json",
    "--output-schema",
    schema,
    "-o",
    report,
    ...(threadId ? ["resume", threadId] : []),
    "-",
  ];
}

export function readThreadId(eventsFile: string): string | undefined {
  for (const line of readFileSync(eventsFile, "utf8").split(/\r?\n/)) {
    try {
      const event: unknown = JSON.parse(line);
      if (
        event &&
        typeof event === "object" &&
        "type" in event &&
        event.type === "thread.started" &&
        "thread_id" in event &&
        typeof event.thread_id === "string" &&
        event.thread_id.trim()
      ) {
        return event.thread_id;
      }
    } catch {
      // Ignore incomplete/malformed events; a missing ID triggers the fallback.
    }
  }
}

async function executeAgent(
  run: CommandRunner,
  directory: string,
  prompt: string,
  attempt: number,
  threadId?: string,
) {
  const schema = join(directory, "report.schema.json");
  const report = join(directory, `report-${attempt}.json`);
  const events = join(directory, `events-${attempt}.jsonl`);
  const agentLog = join(directory, `agent-${attempt}.log`);
  writeFileSync(join(directory, `prompt-${attempt}.md`), prompt);
  for (const file of [events, report, agentLog]) writeFileSync(file, "");
  writeReportSchema(schema);
  const cache = (await run(["go", "env", "GOCACHE"])).stdout.trim();
  if (!cache) throw new Error("go env GOCACHE returned an empty path");
  const result = await run(
    ["codex", ...codexArgs({ schema, report, cache, threadId })],
    {
      input: prompt,
      stdoutFile: events,
      stderrFile: agentLog,
      allowFailure: true,
    },
  );
  if (result.code !== 0) {
    const detail = readFileSync(agentLog, "utf8")
      .trim()
      .split(/\r?\n/)
      .slice(-20)
      .join("\n");
    throw new AgentCommandError(
      `Codex exit=${result.code}; see ${agentLog}${detail ? `\n${detail}` : ""}`,
    );
  }
  return {
    report: parseReport(readFileSync(report, "utf8")),
    threadId: readThreadId(events) ?? threadId,
  };
}

export function runAgent(
  run: CommandRunner,
  directory: string,
  prompt: string,
  attempt = 1,
) {
  return executeAgent(run, directory, prompt, attempt);
}

export function resumeAgent(
  run: CommandRunner,
  directory: string,
  threadId: string,
  prompt: string,
  attempt: number,
) {
  return executeAgent(run, directory, prompt, attempt, threadId);
}
