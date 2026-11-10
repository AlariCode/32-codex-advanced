import assert from "node:assert/strict";
import test from "node:test";
import type { Thread, ThreadEvent } from "@openai/codex-sdk";
import { compact } from "./lib/log.ts";
import { parseIssueNumber } from "./lib/io.ts";
import {
  attempt,
  runTurn as executeTurn,
  addUsage,
  emptyUsage,
  tokens,
  workerOptions,
} from "./lib/attempt.ts";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
const testTmp = join(process.cwd(), "tmp");
await mkdir(testTmp, { recursive: true });

test("режим исполнителя по умолчанию ограничен; полный доступ включается явно", () => {
  const saved = process.env.RALPH_WORKER_SANDBOX;
  try {
    delete process.env.RALPH_WORKER_SANDBOX;
    assert.equal(workerOptions("/repo").sandboxMode, "workspace-write");
    process.env.RALPH_WORKER_SANDBOX = "danger-full-access";
    assert.deepEqual(workerOptions("/repo"), {
      workingDirectory: "/repo",
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    process.env.RALPH_WORKER_SANDBOX = "invalid";
    assert.throws(() => workerOptions("/repo"), /RALPH_WORKER_SANDBOX/);
  } finally {
    if (saved === undefined) delete process.env.RALPH_WORKER_SANDBOX;
    else process.env.RALPH_WORKER_SANDBOX = saved;
  }
});

// Keep the original behavioural cases while exercising the extracted attempt.
async function solve(
  thread: Pick<Thread, "runStreamed">,
  task: typeof issue,
  saveThread: (id: string) => Promise<void>,
  check: (fixes: number) => Promise<{ code: number; output: string }>,
  log: (line: string) => void,
) {
  const directory = await mkdtemp(join(testTmp, "ralph-sdk-test-"));
  try {
    const result = await attempt(
      task,
      {
        startThread: () => thread as Thread,
        resumeThread: () => thread as Thread,
      },
      { root: process.cwd(), directory, saveThread, check, log },
    );
    return {
      passed: result.checkOk,
      fixes: result.fixes,
      response: result.report.summary,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function runTurn(
  thread: Pick<Thread, "runStreamed">,
  prompt: string,
  saveThread: (id: string) => Promise<void>,
  log: (line: string) => void,
) {
  return executeTurn(thread, prompt, { saveThread, log });
}

const issue = {
  number: 42,
  title: "Исправить поиск",
  body: "Поиск должен работать",
  url: "https://github.com/example/repo/issues/42",
};
const completed: ThreadEvent = {
  type: "turn.completed",
  usage: {
    input_tokens: 1,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 1,
    reasoning_output_tokens: 0,
  },
};

function mockThread(events: ThreadEvent[]) {
  const prompts: string[] = [];
  const thread: Pick<Thread, "runStreamed"> = {
    async runStreamed(input) {
      assert.equal(typeof input, "string");
      prompts.push(input as string);
      return {
        events: (async function* () {
          for (const event of events) {
            if (
              event.type === "turn.completed" &&
              !events.some(
                (e) =>
                  e.type === "item.completed" &&
                  e.item.type === "agent_message",
              )
            ) {
              yield {
                type: "item.completed",
                item: {
                  type: "agent_message",
                  id: "report",
                  text: JSON.stringify({ summary: "", files: [] }),
                },
              } as ThreadEvent;
            }
            yield event;
          }
        })(),
      };
    },
  };
  return { thread, prompts };
}

test("номер задачи — один положительный safe integer", () => {
  assert.equal(parseIssueNumber(["42"]), 42);
  for (const args of [
    [],
    ["0"],
    ["-1"],
    ["1.5"],
    ["42", "43"],
    ["1e2"],
    ["9007199254740992"],
  ]) {
    assert.throws(() => parseIssueNumber(args));
  }
});

test("зелёная проверка завершает попытку без лишних ходов; ID сохранён до проверки", async () => {
  const { thread, prompts } = mockThread([
    { type: "thread.started", thread_id: "saved-thread" },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "answer",
        text: JSON.stringify({ summary: "Готово", files: [] }),
      },
    },
    completed,
  ]);
  let saved: string | undefined;
  const result = await solve(
    thread,
    issue,
    async (id) => {
      saved = id;
    },
    async (attempt) => {
      assert.equal(saved, "saved-thread");
      assert.equal(attempt, 0);
      return { code: 0, output: "" };
    },
    () => {},
  );
  assert.deepEqual(result, { passed: true, fixes: 0, response: "Готово" });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Поиск должен работать/);
  assert.match(prompts[0], /Не запускай make check/);
});

for (const passesOn of [1, 2, undefined]) {
  test(`не более двух исправлений: успешная проверка ${passesOn ?? "отсутствует"}`, async () => {
    const { thread, prompts } = mockThread([completed]);
    const checks: number[] = [];
    const result = await solve(
      thread,
      issue,
      async () => {},
      async (attempt) => {
        checks.push(attempt);
        return {
          code: attempt === passesOn ? 0 : 2,
          output: `ошибка проверки ${attempt}`,
        };
      },
      () => {},
    );
    const last = passesOn ?? 2;
    assert.equal(result.passed, passesOn !== undefined);
    assert.equal(result.fixes, last);
    assert.equal(prompts.length, last + 1);
    assert.deepEqual(
      checks,
      Array.from({ length: last + 1 }, (_, i) => i),
    );
    for (let i = 1; i < prompts.length; i++)
      assert.match(prompts[i], new RegExp(`ошибка проверки ${i - 1}`));
  });
}

test("ошибки стрима останавливают запуск и сохраняют уже полученный thread_id", async () => {
  for (const failure of [
    { type: "turn.failed", error: { message: "model failed" } },
    { type: "error", message: "stream failed" },
    undefined,
  ] as const) {
    const { thread } = mockThread([
      { type: "thread.started", thread_id: "recoverable" },
      ...(failure ? [failure] : []),
    ]);
    let saved: string | undefined;
    let checks = 0;
    await assert.rejects(
      solve(
        thread,
        issue,
        async (id) => {
          saved = id;
        },
        async () => {
          checks++;
          return { code: 0, output: "" };
        },
        () => {},
      ),
    );
    assert.equal(saved, "recoverable");
    assert.equal(checks, 0);
  }
});

test("стрим команд компактен, дельты и полный stdout скрыты", async () => {
  const item = {
    type: "command_execution",
    id: "command",
    command: "echo\n hello",
    status: "in_progress",
    aggregated_output: "",
  } as const;
  const { thread } = mockThread([
    { type: "item.started", item },
    {
      type: "item.updated",
      item: { ...item, aggregated_output: "скрытый вывод" },
    },
    {
      type: "item.completed",
      item: {
        ...item,
        status: "completed",
        exit_code: 0,
        aggregated_output: "скрытый вывод",
      },
    },
    completed,
  ]);
  const lines: string[] = [];
  await runTurn(
    thread,
    "prompt",
    async () => {},
    (line) => lines.push(line),
  );
  assert.deepEqual(lines.slice(0, 2), ["  $ echo hello", "  ✓ exit 0"]);
  assert.equal(compact("\u001b[31mred\u001b[0m\ntext"), "red text");
  assert.equal(compact("x".repeat(300)).length, 140);
});

test("usage суммируется по ходам, включая cached input без двойного счёта", async () => {
  const usage = emptyUsage();
  const { thread } = mockThread([completed]);
  let turns = 0;
  await executeTurn(thread, "prompt", {
    log: () => {},
    onUsage: async (part) => {
      turns++;
      addUsage(usage, { ...part, cached_input_tokens: 1 });
    },
  });
  assert.equal(turns, 1);
  assert.equal(tokens(usage), 2);
});

test("таймаут передаёт AbortSignal и останавливает ход", async () => {
  const thread: Pick<Thread, "runStreamed"> = {
    async runStreamed(_prompt, options) {
      assert.ok(options?.signal);
      return {
        events: (async function* () {
          await new Promise((_resolve, reject) => {
            options.signal!.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        })(),
      };
    },
  };
  await assert.rejects(
    executeTurn(thread, "prompt", { timeoutMs: 5 }),
    /Таймаут/,
  );
});

test("сохранённый этап check возобновляет worker, не повторяя ход", async () => {
  const directory = await mkdtemp(join(testTmp, "ralph-sdk-test-"));
  let resumed = false;
  try {
    const result = await attempt(
      issue,
      {
        startThread: () => {
          throw new Error("новый поток запрещён");
        },
        resumeThread: (id) => {
          assert.equal(id, "worker-id");
          resumed = true;
          return {
            runStreamed: () => {
              throw new Error("повторный ход запрещён");
            },
          } as unknown as Thread;
        },
      },
      {
        root: process.cwd(),
        directory,
        threadId: "worker-id",
        log: () => {},
        progress: {
          phase: "check",
          fixes: 1,
          prompt: "",
          report: { summary: "Готово", files: ["file.ts"] },
        },
        check: async (fixes) => {
          assert.equal(fixes, 1);
          return { code: 0, output: "" };
        },
      },
    );
    assert.ok(resumed);
    assert.equal(result.threadId, "worker-id");
    assert.equal(result.checkOk, true);
    assert.equal(tokens(result.usage), 0);
    assert.deepEqual(result.report.files, ["file.ts"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("предохранитель останавливает запуск до нового хода", async () => {
  let called = false;
  const thread = {
    runStreamed: async () => {
      called = true;
      throw new Error("лишний ход");
    },
  };
  await assert.rejects(
    executeTurn(thread, "prompt", {
      beforeTurn: () => {
        throw new Error("Бюджет исчерпан");
      },
    }),
    /Бюджет/,
  );
  assert.equal(called, false);
});
