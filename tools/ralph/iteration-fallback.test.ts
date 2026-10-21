import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./iteration-test-helpers.ts";

test("missing thread ID triggers one fresh fallback with the full task and log", async (t) => {
  const f = fixture(t, {
    agents: [{}, { threadId: "replacement" }, {}],
    checks: [false, false, true],
  });
  await f.launch();
  const calls = f.codex();
  assert.equal(calls[1].command.includes("resume"), false);
  assert.match(calls[1].prompt!, /Acceptance criteria/);
  assert.match(calls[1].prompt!, /Original constraints/);
  assert.match(calls[1].prompt!, /check-1/);
  assert.deepEqual(calls[2].command.slice(-3), ["resume", "replacement", "-"]);
  assert.match(f.runLog(), /fallback: thread_id not found/);
});

test("failed resume preserves its artifacts and falls back once within the same fix", async (t) => {
  const f = fixture(t, {
    agents: [{ threadId: "lost" }, { code: 1 }, { threadId: "new" }, {}],
    checks: [false, false, true],
  });
  await f.launch(2);
  const calls = f.codex();
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].command.slice(-3), ["resume", "lost", "-"]);
  assert.equal(calls[2].command.includes("resume"), false);
  assert.match(calls[2].prompt!, /check-1/);
  assert.deepEqual(calls[3].command.slice(-3), ["resume", "new", "-"]);
  assert.match(f.read("agent-2.log"), /no rollout found/);
  assert.equal(f.read("check-2.log"), "");
  assert.match(
    f.runLog(),
    /attempt=2 thread_id=lost check=not-run agent-error/,
  );
  assert.match(f.runLog(), /fallback: resume failed: Codex exit=1/);
  assert.match(f.runLog(), /no rollout found/);
  assert.match(f.runLog(), /attempt=4 thread_id=new check=green/);
});

test("a failed fresh fallback stops instead of recursively starting new agents", async (t) => {
  const f = fixture(t, {
    agents: [{ threadId: "lost" }, { code: 1 }, { code: 1 }],
    checks: [false],
  });
  await assert.rejects(f.launch(), /Codex exit=1/);
  assert.equal(f.codex().length, 3);
  assert.equal(f.count("check"), 1);
});

test("missing ID fallback uses a single fix budget", async (t) => {
  const f = fixture(t, { agents: [{}, {}], checks: [false, false] });
  await assert.rejects(f.launch(1), /Fix attempts exhausted/);
  assert.equal(f.codex().length, 2);
});

test("a corrupt resume report remains an error and does not trigger fresh work", async (t) => {
  const f = fixture(t, {
    agents: [{ threadId: "saved" }, { malformed: true }],
    checks: [false],
  });
  await assert.rejects(f.launch(), SyntaxError);
  assert.equal(f.codex().length, 2);
  assert.equal(f.count("check"), 1);
});
