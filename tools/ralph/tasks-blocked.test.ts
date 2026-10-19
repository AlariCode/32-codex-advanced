import { test } from "node:test";
import assert from "node:assert/strict";
import { markBlocked } from "./tasks.ts";
import type { CommandRunner } from "./exec.ts";

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
