import { test } from "node:test";
import assert from "node:assert/strict";
import { runnerFixture } from "./runner-test-helpers.ts";

for (const existing of [false, true]) {
  test(`failed then success continues and publishes summary (existing PR=${existing})`, (t) => {
    const f = runnerFixture(t, ["failed", "done"]);
    const r = f.launch(existing ? { EXISTING_PR: "1" } : {});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.state.closed, [2]);
    assert.deepEqual(r.state.labels[1], ["ralph-failed"]);
    assert.match(
      r.state.comments.find(
        (c: { kind: string; number: number }) =>
          c.kind === "issue" && c.number === 1,
      ).body,
      /git stash apply [a-f0-9]{40}/,
    );
    assert.match(r.summary, /вход 16, кэш 10, выход 4; сумма 20/);
    assert.match(r.summary, /задачи кончились/);
    assert.equal(
      existing
        ? r.state.comments.find((c: { kind: string }) => c.kind === "pr").body
        : r.state.prBody,
      r.summary,
    );
    assert.equal(r.stdout.trimEnd().split("\n").at(-1), r.path);
    assert.equal(f.git("branch", "--show-current"), "ralph/phase-2");
    assert.match(f.git("branch", "--list", "issue-1"), /issue-1/);
  });
}
test("two consecutive failures stop before third task", (t) => {
  const r = runnerFixture(t, ["failed", "failed", "done"]).launch();
  assert.equal(r.state.calls, 2);
  assert.match(r.summary, /предохранитель — 2 неудач подряд/);
});
test("blocked is not a failure and success resets streak", (t) => {
  const r = runnerFixture(t, [
    "failed",
    "done",
    "blocked",
    "failed",
    "done",
  ]).launch();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.state.calls, 5);
  assert.deepEqual(r.state.closed, [2, 5]);
  assert.match(r.summary, /задачи кончились/);
});
test("preflight red stops before Codex and writes summary", (t) => {
  const r = runnerFixture(t, ["done"]).launch({ RED: "1" });
  assert.equal(r.status, 1);
  assert.equal(r.state.calls, 0);
  assert.match(r.summary, /preflight — окружение или ветка фазы уже красные/);
});
test("skip-preflight bypasses startup checks", (t) => {
  const r = runnerFixture(t, ["blocked"]).launch({ RED: "1" }, [
    "--skip-preflight",
  ]);
  assert.equal(r.state.calls, 1);
  assert.match(r.summary, /задачи кончились/);
});
test("token budget finishes current task and never starts next", (t) => {
  const r = runnerFixture(t, ["done", "done"], { maxTokens: 1 }).launch();
  assert.equal(r.state.calls, 1);
  assert.deepEqual(r.state.closed, [1]);
  assert.match(r.summary, /Причина остановки: maxTokens/);
});
test("iteration limit stops before another task", (t) => {
  const r = runnerFixture(t, ["done", "done"]).launch({}, [
    "--max-iterations",
    "1",
  ]);
  assert.equal(r.state.calls, 1);
  assert.match(r.summary, /Причина остановки: лимит итераций/);
});
test("runner error still writes summary and prints its path last", (t) => {
  const r = runnerFixture(t, ["done"]).launch({ GH_FAIL: "issue list" });
  assert.equal(r.status, 1);
  assert.match(r.summary, /ошибка раннера/);
  assert.equal(r.stdout.trimEnd().split("\n").at(-1), r.path);
});

test("double reviewer failure parks task and continues; all reviewer usage counts", (t) => {
  const r = runnerFixture(t, ["done", "blocked"], {
    review: { enabled: true, blockingPriorities: [0, 1] },
  }).launch({ REVIEW_FAIL: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.state.calls, 4);
  assert.deepEqual(r.state.labels[1], ["ralph-failed"]);
  assert.deepEqual(r.state.labels[2], ["blocked"]);
  assert.match(r.summary, /Review failed twice/);
  assert.match(r.summary, /вход 32, кэш 20, выход 8; сумма 40/);
});
test("fix exhaustion parks task and continues", (t) => {
  const r = runnerFixture(t, ["done", "blocked"]).launch({ RED: "1" }, [
    "--skip-preflight",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.state.labels[1], ["ralph-failed"]);
  assert.match(r.summary, /Fix attempts exhausted/);
  assert.equal(r.state.calls, 3);
});
test("PR publication error retains summary and its final console path", (t) => {
  const r = runnerFixture(t, ["done"]).launch({ GH_FAIL: "pr create" });
  assert.equal(r.status, 1);
  assert.match(r.summary, /ошибка раннера — Публикация отчёта/);
  assert.equal(r.stdout.trimEnd().split("\n").at(-1), r.path);
});
