import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  attempt,
  issueText,
  runTurn,
  type Progress,
  type Report,
} from "./attempt.ts";
import { loadIssue, readCommand } from "./io.ts";

export const reviewSchema = z.object({
  findings: z.array(
    z.object({
      priority: z.enum(["P0", "P1", "P2", "P3"]),
      file: z.string(),
      line: z.number().int().min(1),
      text: z.string(),
    }),
  ),
});
export type Finding = z.infer<typeof reviewSchema>["findings"][number];
export const blockers = (findings: Finding[]) =>
  findings.filter((f) => f.priority === "P0" || f.priority === "P1");
type ActiveStage = "attempt" | "review" | "fix" | "commit";
type Stage = ActiveStage | "comment" | "stopped";
interface State {
  workingDirectory?: string;
  issue: number;
  stage: Stage;
  round: number;
  workerThreadId: string | null;
  tokens: number;
  findings: Finding[];
  progress?: Progress;
  report: Report;
  reviewThreadId?: string;
  reason?: string;
  baseHead?: string;
  commit?: string;
  maxReviewRounds?: number;
  maxTokens?: number;
  timeoutMs?: number;
  resumeStage?: ActiveStage;
}
export const runtimeDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".ralph",
);
export interface RalphEvent {
  stage: "attempt" | "check" | "review" | "fix" | "commit";
  round: number;
  tokens: number;
  event?: ThreadEvent;
  message?: string;
}
export interface RalphResult {
  issue: number;
  status: "committed" | "stopped";
  reason?: string;
  commit?: string;
  rounds: number;
  tokens: number;
  branch: string;
}
const findingText = (findings: Finding[]) =>
  findings
    .map((f) => `- ${f.priority} ${f.file}:${f.line} — ${f.text}`)
    .join("\n") || "Нет";
export function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name}: ожидается положительное целое число`);
  return value;
}

export async function ralph(
  number: number,
  {
    workingDirectory,
    onEvent,
    extraReviewRounds,
    codex = new Codex(),
    stateDirectory = runtimeDirectory,
  }: {
    workingDirectory: string;
    onEvent?: (event: RalphEvent) => void | Promise<void>;
    extraReviewRounds?: number;
    codex?: Pick<Codex, "startThread" | "resumeThread">;
    stateDirectory?: string;
  },
): Promise<RalphResult> {
  const root = resolve(workingDirectory);
  let maxTokens = positiveEnv("RALPH_MAX_TOKENS", 3_000_000);
  let timeoutMs = positiveEnv("RALPH_TURN_TIMEOUT_MIN", 20) * 60_000;
  const maxReviewRounds = positiveEnv("RALPH_MAX_REVIEW_ROUNDS", 2);
  const branch = await readCommand("git", ["branch", "--show-current"], root);
  const path = join(stateDirectory, `state-${number}.json`);
  let state: State = {
    workingDirectory: root,
    issue: number,
    stage: "attempt",
    round: 0,
    workerThreadId: null,
    tokens: 0,
    findings: [],
    report: { summary: "", files: [] },
  };
  let resumed = false;
  try {
    state = JSON.parse(await readFile(path, "utf8"));
    if (state.issue !== number)
      throw new Error("Неверный номер задачи в состоянии");
    if (state.workingDirectory && state.workingDirectory !== root)
      throw new Error(
        `Состояние #${number} принадлежит ${state.workingDirectory}`,
      );
    state.workingDirectory = root;
    resumed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!resumed && extraReviewRounds === undefined) {
    try {
      const saved = JSON.parse(
        await readFile(join(stateDirectory, `result-${number}.json`), "utf8"),
      );
      if (
        saved.issue === number &&
        saved.status === "stopped" &&
        (!saved.workingDirectory || saved.workingDirectory === root)
      )
        return saved as RalphResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  state.maxReviewRounds ??= maxReviewRounds;
  // Restarting may tighten limits, but must never reset or enlarge them.
  maxTokens = Math.min(state.maxTokens ?? maxTokens, maxTokens);
  timeoutMs = Math.min(state.timeoutMs ?? timeoutMs, timeoutMs);
  state.maxTokens = maxTokens;
  state.timeoutMs = timeoutMs;
  const result = (): RalphResult => ({
    issue: number,
    status: state.commit ? "committed" : "stopped",
    reason: state.reason,
    commit: state.commit,
    rounds: state.round,
    tokens: state.tokens,
    branch,
  });
  if (extraReviewRounds !== undefined) {
    if (!Number.isSafeInteger(extraReviewRounds) || extraReviewRounds <= 0)
      throw new Error(
        "Дополнительные раунды: ожидается положительное целое число",
      );
    if (
      !resumed ||
      !state.resumeStage ||
      (state.stage !== "stopped" && state.stage !== "comment") ||
      state.commit
    )
      throw new Error(
        `Нет сохранённой остановленной попытки #${number} для возобновления`,
      );
    const ceiling = state.maxReviewRounds + extraReviewRounds;
    if (!Number.isSafeInteger(ceiling))
      throw new Error("Слишком много раундов ревью");
    state.maxReviewRounds = ceiling;
    state.stage = state.resumeStage;
    state.resumeStage = undefined;
    state.reason = undefined;
  } else if (state.stage === "stopped") {
    return result();
  }
  let stage: RalphEvent["stage"] = "attempt";
  const emit = (extra: Partial<RalphEvent> = {}) =>
    onEvent?.({ stage, round: state.round, tokens: state.tokens, ...extra });
  const save = async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + "\n");
    await rename(`${path}.tmp`, path);
  };
  const budget = () => {
    if (state.tokens >= maxTokens)
      throw new Error(`Бюджет токенов исчерпан: ${state.tokens}/${maxTokens}`);
  };
  const hooks = {
    timeoutMs,
    ...(onEvent ? { log: () => {} } : {}),
    onEvent: async (event: ThreadEvent) => {
      await emit({ event });
    },
    beforeTurn: budget,
    onUsage: async (usage: { input_tokens: number; output_tokens: number }) => {
      state.tokens += usage.input_tokens + usage.output_tokens;
      await emit();
      await save();
      if (state.tokens > maxTokens)
        throw new Error(
          `Превышен бюджет токенов: ${state.tokens}/${maxTokens}`,
        );
    },
  };
  try {
    if (!resumed && (await readCommand("git", ["status", "--porcelain"], root)))
      throw new Error("Рабочая копия не чистая; новая задача не запущена");
    await save();
    const issue = await loadIssue(number, root);
    while (state.stage !== "comment") {
      stage = state.stage;
      await emit();
      if (state.stage === "attempt" || state.stage === "fix") {
        const result = await attempt(issue, codex, {
          root,
          directory: join(
            stateDirectory,
            "artifacts",
            `issue-${number}`,
            `${state.stage}-${state.round}`,
          ),
          threadId: state.workerThreadId ?? undefined,
          progress: state.progress,
          prompt:
            state.stage === "fix"
              ? `Исправь все замечания ревью целиком:\n${JSON.stringify(blockers(state.findings), null, 2)}`
              : undefined,
          ...hooks,
          saveThread: async (id) => {
            state.workerThreadId = id;
            await save();
          },
          onProgress: async (progress) => {
            stage =
              progress.phase === "check"
                ? "check"
                : progress.fixes
                  ? "fix"
                  : (state.stage as "attempt" | "fix");
            await emit();
            state.progress = progress;
            state.report = progress.report;
            await save();
          },
        });
        state.report = result.report;
        state.progress = undefined;
        if (!result.checkOk)
          throw new Error("make check не пройден после двух исправлений");
        state.stage = "review";
        await save();
      } else if (state.stage === "review") {
        const options = {
          workingDirectory: root,
          sandboxMode: "read-only" as const,
          approvalPolicy: "never" as const,
          model: process.env.RALPH_REVIEW_MODEL ?? "gpt-6-astra",
          modelReasoningEffort: "high" as const,
        };
        const thread = state.reviewThreadId
          ? codex.resumeThread(state.reviewThreadId, options)
          : codex.startThread(options);
        if (!onEvent)
          console.log(`\n▶ Ревью ${state.round + 1}/${state.maxReviewRounds}`);
        const turn = await runTurn(
          thread,
          `Проведи ревью решения задачи. Изучи AGENTS.md. Изменения — в git diff рабочей копии (включая staged и новые файлы), файлы не меняй.
Не запускай Ralph, не делай commit, push и не изменяй GitHub. Верни замечания с приоритетом, файлом и строкой.\n\n${issueText(issue)}`,
          {
            ...hooks,
            saveThread: async (id) => {
              state.reviewThreadId = id;
              await save();
            },
          },
          { outputSchema: zodToJsonSchema(reviewSchema, { target: "openAi" }) },
        );
        state.findings = reviewSchema.parse(JSON.parse(turn.response)).findings;
        state.reviewThreadId = undefined;
        state.round++;
        if (!blockers(state.findings).length) state.stage = "commit";
        else if (state.round < state.maxReviewRounds) state.stage = "fix";
        else {
          state.reason = `Не одобрено после ${state.round} раундов ревью`;
          state.resumeStage = "fix";
          state.stage = "comment";
        }
        await save();
      } else if (state.stage === "commit") {
        // Save HEAD before the side effect: a restart must not create a second commit.
        const head = await readCommand("git", ["rev-parse", "HEAD"], root);
        if (!state.baseHead) {
          state.baseHead = head;
          await save();
        }
        if (head === state.baseHead) {
          await readCommand(
            "git",
            ["add", "-A", "--", ".", ":(glob,exclude)**/.ralph/**"],
            root,
          );
          await readCommand(
            "git",
            [
              "commit",
              "-m",
              `${issue.title} (#${number})`,
              "-m",
              state.report.summary,
            ],
            root,
          );
          state.commit = await readCommand("git", ["rev-parse", "HEAD"], root);
        } else {
          const subject = await readCommand(
            "git",
            ["log", "-1", "--format=%s"],
            root,
          );
          const parent = await readCommand("git", ["rev-parse", "HEAD^"], root);
          if (
            subject !== `${issue.title} (#${number})` ||
            parent !== state.baseHead
          )
            throw new Error(
              "HEAD изменился при восстановлении; коммит требует ручной проверки",
            );
          state.commit = head;
        }
        await emit({ message: `✓ коммит ${state.commit}` });
        state.stage = "comment";
        await save();
      }
    }
  } catch (error) {
    if (state.stage !== "comment") state.resumeStage = state.stage;
    state.reason = error instanceof Error ? error.message : String(error);
    state.stage = "comment";
    await save();
  }
  // A failed comment leaves this stage on disk so the next invocation only retries it.
  const body = [
    state.commit ? `Результат: commit ${state.commit}` : "Результат: stopped",
    state.report.summary || "Работа не завершена.",
    `Файлы:\n${state.report.files.map((file) => `- ${file}`).join("\n") || "Нет отчёта о файлах"}`,
    `Раунды ревью: ${state.round}/${state.maxReviewRounds}. Токены (input + output): ${state.tokens}.`,
    `Открытые P0–P1:\n${findingText(blockers(state.findings))}`,
    `Открытые P2–P3:\n${findingText(state.findings.filter((f) => f.priority === "P2" || f.priority === "P3"))}`,
    ...(state.reason ? [`Причина остановки: ${state.reason}`] : []),
  ].join("\n\n");
  const commentPath = join(stateDirectory, `comment-${number}.md`);
  await mkdir(dirname(commentPath), { recursive: true });
  await writeFile(commentPath, body + "\n");
  try {
    await readCommand(
      "gh",
      ["issue", "comment", String(number), "--body-file", commentPath],
      root,
    );
    const outcome = result();
    await writeFile(
      join(stateDirectory, `result-${number}.json`),
      JSON.stringify({ ...outcome, workingDirectory: root }, null, 2) + "\n",
    );
    if (state.commit) await rm(path);
    else {
      state.stage = "stopped";
      await save();
    }
    return outcome;
  } catch (error) {
    const reason = `Комментарий #${number} не опубликован; состояние сохранено: ${error instanceof Error ? error.message : error}`;
    if (!onEvent) console.error(reason);
    return {
      issue: number,
      status: "stopped",
      reason,
      commit: state.commit,
      rounds: state.round,
      tokens: state.tokens,
      branch,
    };
  }
}
