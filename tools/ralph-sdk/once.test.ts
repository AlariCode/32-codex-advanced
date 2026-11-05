import assert from "node:assert/strict";
import test from "node:test";
import type { Thread, ThreadEvent } from "@openai/codex-sdk";
import { compact, parseIssueNumber, runTurn, solve } from "./once.ts";

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
          yield* events;
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
      item: { type: "agent_message", id: "answer", text: "Готово" },
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
  assert.deepEqual(lines, ["  $ echo hello", "  ✓ exit 0"]);
  assert.equal(compact("\u001b[31mred\u001b[0m\ntext"), "red text");
  assert.equal(compact("x".repeat(300)).length, 140);
});
