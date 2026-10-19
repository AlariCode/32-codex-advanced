import { test } from "node:test";
import assert from "node:assert/strict";
import { showDryRun } from "./dry-run.ts";

test("dry-run shows resume with sandbox and output flags before the subcommand", (t) => {
  const output: string[] = [];
  t.mock.method(console, "log", (line: string) => output.push(line));
  showDryRun(
    { number: 8, title: "Formatting", body: "", labels: [] },
    {
      label: "phase-2",
      branch: "ralph/phase-2",
      maxIterations: 10,
      maxFixAttempts: 3,
      checks: [["make", "check"]],
    },
  );
  const command = output.find(
    (line) => line.startsWith('"codex"') && line.includes('"resume"'),
  )!;
  assert.ok(command);
  assert.ok(command.indexOf('"--sandbox"') < command.indexOf('"resume"'));
  assert.ok(command.indexOf('"--add-dir"') < command.indexOf('"resume"'));
  assert.match(command, /"resume" "<thread_id>" "-"$/);
  assert.match(output.join("\n"), /maxFixAttempts: 3/);
});
