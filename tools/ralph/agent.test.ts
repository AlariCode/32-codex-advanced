import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexArgs, readThreadId } from "./agent.ts";

const args = {
  schema: "/tmp/schema.json",
  report: "/tmp/report.json",
  cache: "/tmp/go cache",
};

test("codexArgs puts every option before resume and keeps the session ID explicit", () => {
  const command = codexArgs({ ...args, threadId: "thread-123" });
  const position = command.indexOf("resume");
  assert.deepEqual(command.slice(position), ["resume", "thread-123", "-"]);
  assert.deepEqual(command.slice(0, position), [
    "exec",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    args.cache,
    "--json",
    "--output-schema",
    args.schema,
    "-o",
    args.report,
  ]);
  assert.equal(command.includes("--ephemeral"), false);
});

test("codexArgs builds a normal persistent launch without resume", () => {
  const command = codexArgs(args);
  assert.equal(command.includes("resume"), false);
  assert.equal(command.includes("--ephemeral"), false);
  assert.equal(command.at(-1), "-");
  assert.equal(command[0], "exec");
});

for (const [name, stream, expected] of [
  [
    "first thread.started",
    '{"type":"thread.started","thread_id":"first"}\n{"type":"thread.started","thread_id":"second"}',
    "first",
  ],
  ["missing event", '{"type":"turn.completed"}\n', undefined],
  [
    "malformed line",
    '{broken\n{"type":"thread.started","thread_id":"valid"}\n',
    "valid",
  ],
  ["only malformed JSON", "{broken\n", undefined],
  [
    "invalid IDs",
    '{"type":"thread.started","thread_id":123}\n{"type":"thread.started","thread_id":" "}\nnull\n',
    undefined,
  ],
] as const) {
  test(`readThreadId: ${name}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ralph-events-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "events.jsonl");
    await writeFile(file, stream);
    assert.equal(readThreadId(file), expected);
  });
}
