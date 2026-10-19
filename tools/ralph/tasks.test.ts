import { test } from "node:test";
import assert from "node:assert/strict";
import { markBlocked, parseDependencies, selectNextTask } from "./tasks.ts";
import type { CommandRunner } from "./exec.ts";
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

for (const labels of [
  [],
  [{ name: "blocked" }],
  [{ name: "Blocked" }],
  [{ name: "blocked-later" }],
]) {
  test(`markBlocked ensures the label exists before editing: ${JSON.stringify(labels)}`, async () => {
    const calls: string[][] = [];
    const summary =
      "Needs credentials\n\nSaved changes: git stash apply abc123";
    const run: CommandRunner = async (command, options) => {
      calls.push(command);
      if (command[2] === "comment") assert.equal(options?.input, summary);
      return { code: 0, stdout: JSON.stringify(labels), stderr: "" };
    };
    await markBlocked(run, 8, summary);
    const needsCreation = !labels.some(
      (label) => label.name.toLowerCase() === "blocked",
    );
    assert.deepEqual(calls, [
      [
        "gh",
        "label",
        "list",
        "--search",
        "blocked",
        "--limit",
        "10000",
        "--json",
        "name",
      ],
      ...(needsCreation
        ? [
            [
              "gh",
              "label",
              "create",
              "blocked",
              "--color",
              "D93F0B",
              "--description",
              "Task cannot proceed until a blocker is resolved",
            ],
          ]
        : []),
      ["gh", "issue", "edit", "8", "--add-label", "blocked"],
      ["gh", "issue", "comment", "8", "--body-file", "-"],
    ]);
  });
}

for (const failure of ["list", "create"]) {
  test(`markBlocked propagates label ${failure} failures without editing the issue`, async () => {
    const run: CommandRunner = async (command) => {
      assert.equal(command[1], "label");
      if (command[2] === failure) throw new Error("GitHub unavailable");
      return { code: 0, stdout: "[]", stderr: "" };
    };
    await assert.rejects(markBlocked(run, 8, "Blocked"), /GitHub unavailable/);
  });
}

for (const stdout of ["", " \n\t"]) {
  test(`markBlocked creates the label when gh returns empty output: ${JSON.stringify(stdout)}`, async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (command) => {
      calls.push(command);
      return { code: 0, stdout, stderr: "" };
    };
    await markBlocked(run, 8, "Blocked");
    assert.deepEqual(
      calls.map((command) => command.slice(0, 3)),
      [
        ["gh", "label", "list"],
        ["gh", "label", "create"],
        ["gh", "issue", "edit"],
        ["gh", "issue", "comment"],
      ],
    );
  });
}

test("markBlocked rejects malformed label JSON without editing the issue", async () => {
  const run: CommandRunner = async (command) => {
    assert.deepEqual(command.slice(0, 3), ["gh", "label", "list"]);
    return { code: 0, stdout: '[{"name":', stderr: "" };
  };
  await assert.rejects(markBlocked(run, 8, "Blocked"), SyntaxError);
});
