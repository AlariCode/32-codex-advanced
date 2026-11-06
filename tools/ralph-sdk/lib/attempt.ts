import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Codex,
  Thread,
  ThreadOptions,
  TurnOptions,
  Usage,
  ThreadEvent,
} from "@openai/codex-sdk";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { command, type Issue } from "./io.ts";
import { logEvent } from "./log.ts";

export const reportSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
});
export type Report = z.infer<typeof reportSchema>;
export const outputSchema = zodToJsonSchema(reportSchema, { target: "openAi" });
export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  reasoning_output_tokens: 0,
});
export function addUsage(total: Usage, usage: Usage) {
  for (const key of Object.keys(total) as (keyof Usage)[])
    total[key] += usage[key];
}
export const tokens = (usage: Usage) =>
  usage.input_tokens + usage.output_tokens;
export const workerOptions = (root: string): ThreadOptions => ({
  workingDirectory: root,
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
});
export const agentRules = `Работай в текущем репозитории и выполни задачу ниже.
Изучи AGENTS.md и относящийся к задаче код. Сохраняй изменения пользователя.
Не запускай make check: эту проверку выполняет внешний раннер после твоего ответа.
Не запускай сам раннер Ralph. Не делай commit, push, PR и не изменяй задачу в GitHub.
В отчёте summary опиши результат и оставшиеся проблемы, files — изменённые файлы.`;
export const issueText = (issue: Issue) =>
  `GitHub #${issue.number}: ${issue.title}\n${issue.url}\n\n${issue.body ?? ""}`;

export interface TurnHooks {
  saveThread?: (id: string) => Promise<void>;
  onUsage?: (usage: Usage) => Promise<void>;
  beforeTurn?: () => void;
  timeoutMs?: number;
  log?: (line: string) => void;
  onEvent?: (event: ThreadEvent) => void | Promise<void>;
}

export async function runTurn(
  thread: Pick<Thread, "runStreamed">,
  prompt: string,
  hooks: TurnHooks = {},
  options: TurnOptions = {},
) {
  hooks.beforeTurn?.();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    hooks.timeoutMs ?? 20 * 60_000,
  );
  let completed = false;
  let response = "";
  let usage = emptyUsage();
  try {
    const { events } = await thread.runStreamed(prompt, {
      ...options,
      signal: controller.signal,
    });
    for await (const event of events) {
      await hooks.onEvent?.(event);
      if (event.type === "thread.started")
        await hooks.saveThread?.(event.thread_id);
      if (event.type === "turn.failed") throw new Error(event.error.message);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "turn.completed") {
        completed = true;
        usage = event.usage;
        await hooks.onUsage?.(usage);
      }
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      )
        response = event.item.text;
      logEvent(event, hooks.log ?? console.log);
    }
    if (!completed)
      throw new Error("Поток Codex завершился без turn.completed");
    return { response, usage };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Таймаут хода Codex");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface Progress {
  phase: "work" | "check";
  fixes: number;
  prompt: string;
  report: Report;
}
interface AttemptOptions extends TurnHooks {
  root: string;
  directory: string;
  threadId?: string;
  prompt?: string;
  progress?: Progress;
  onProgress?: (progress: Progress) => Promise<void>;
  check?: (fixes: number) => Promise<{ code: number; output: string }>;
}

export async function attempt(
  issue: Issue,
  codex: Pick<Codex, "startThread" | "resumeThread">,
  options: AttemptOptions,
) {
  const { root, directory } = options;
  await mkdir(directory, { recursive: true });
  let threadId = options.threadId ?? "";
  const thread = threadId
    ? codex.resumeThread(threadId, workerOptions(root))
    : codex.startThread(workerOptions(root));
  const usage = emptyUsage();
  const progress: Progress = options.progress ?? {
    phase: "work",
    fixes: 0,
    prompt: `${agentRules}\n\n${issueText(issue)}\n\n${options.prompt ?? ""}`,
    report: { summary: "", files: [] },
  };
  for (;;) {
    await options.onProgress?.(progress);
    if (progress.phase === "work") {
      (options.log ?? console.log)(
        `\n▶ Попытка · исправлений ${progress.fixes}/2`,
      );
      const turn = await runTurn(
        thread,
        progress.prompt,
        {
          ...options,
          saveThread: async (id) => {
            threadId = id;
            await options.saveThread?.(id);
          },
          onUsage: async (part) => {
            addUsage(usage, part);
            await options.onUsage?.(part);
          },
        },
        { outputSchema },
      );
      progress.report = reportSchema.parse(JSON.parse(turn.response));
      progress.phase = "check";
      await options.onProgress?.(progress);
    }
    (options.log ?? console.log)("\n▶ make check");
    const check = await (options.check?.(progress.fixes) ??
      command("make", ["check"], root));
    await writeFile(
      join(directory, `check-${progress.fixes}.log`),
      check.output,
    );
    if (check.code === 0 || progress.fixes === 2) {
      const result = {
        threadId,
        checkOk: check.code === 0,
        fixes: progress.fixes,
        report: progress.report,
        usage,
      };
      await writeFile(
        join(directory, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      return result;
    }
    progress.fixes++;
    progress.phase = "work";
    progress.prompt = `${agentRules}\n\nПродолжи решение задачи #${issue.number} в этой же сессии.
Внешняя проверка make check завершилась с кодом ${check.code}.
Исправь причины сбоя. Осталось ходов на исправление: ${3 - progress.fixes}.
Последние 120 строк вывода (не более 24000 символов):\n\n${check.output.split("\n").slice(-120).join("\n").slice(-24000)}`;
  }
}
