import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDependencies, selectNextTask } from "./tasks.ts";
import type { Task } from "./tasks.ts";

const task = (number: number, body = "", blocked = false): Task => ({
  number,
  title: `Task ${number}`,
  body,
  labels: blocked ? [{ name: "blocked" }] : [],
});

test("dependencies include markdown links and multiple unique references", () => {
  assert.deepEqual(
    parseDependencies(
      "## Зависимости\n- [#123](https://example/123)\n- #456, #123",
    ),
    [123, 456],
  );
});

test("нет and missing section mean no dependencies", () => {
  assert.deepEqual(parseDependencies("## Зависимости\nнет"), []);
  assert.deepEqual(parseDependencies("## Description\n#123"), []);
});

test("only dependency section is parsed, including nested headings", () => {
  assert.deepEqual(
    parseDependencies(
      "# Task #1\n## Зависимости\n#2\n### Details\n#3\n## Проверка\n#4",
    ),
    [2, 3],
  );
  assert.deepEqual(
    parseDependencies("## Зависимости\r\nНет.\r\n## Other\r\n#4"),
    [],
  );
});

test("selects smallest eligible task, skips blocked and open dependencies", async () => {
  const tasks = [
    task(9),
    task(1, "", true),
    task(2, "## Зависимости\n#20"),
    task(5, "## Зависимости\n[#21](url)"),
  ];
  const selected = await selectNextTask(tasks, async (number) =>
    number === 21 ? "CLOSED" : "OPEN",
  );
  assert.equal(selected?.number, 5);
  assert.deepEqual(
    tasks.map((item) => item.number),
    [9, 1, 2, 5],
  );
});

test("all dependencies must be closed; state lookups are cached", async () => {
  const calls: number[] = [];
  const selected = await selectNextTask(
    [task(1, "## Зависимости\n#10 #11"), task(2, "## Зависимости\n#10")],
    async (number) => {
      calls.push(number);
      return number === 10 ? "CLOSED" : "OPEN";
    },
  );
  assert.equal(selected?.number, 2);
  assert.deepEqual(calls, [10, 11]);
});

test("no eligible task returns undefined, without checking blocked dependencies", async () => {
  assert.equal(
    await selectNextTask([task(1, "## Зависимости\n#2", true)], async () => {
      throw new Error("should not be called");
    }),
    undefined,
  );
});

test("dependency lookup errors are propagated", async () => {
  await assert.rejects(
    selectNextTask([task(1, "## Зависимости\n#2")], async () => {
      throw new Error("GitHub unavailable");
    }),
    /GitHub unavailable/,
  );
});
