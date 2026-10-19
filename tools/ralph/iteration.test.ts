import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./iteration-test-helpers.ts";

test("green initial attempt commits without resume", async (t) => {
  const f = fixture(t);
  assert.equal((await f.launch()).status, "done");
  assert.equal(f.codex().length, 1);
  assert.equal(f.count("commit"), 1);
  assert.match(f.runLog(), /attempt=1 thread_id=thread-1 check=green/);
});

test("repeated red checks resume the same session and preserve numbered artifacts", async (t) => {
  const f = fixture(t, {
    agents: [{ threadId: "saved" }, {}, {}],
    checks: [false, false, true],
    outputs: ["FIRST\n", "SECOND\n", "THIRD\n"],
  });
  await f.launch();
  const calls = f.codex();
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1))
    assert.deepEqual(call.command.slice(-3), ["resume", "saved", "-"]);
  assert.match(calls[1].prompt!, /FIRST/);
  assert.match(calls[2].prompt!, /SECOND/);
  assert.doesNotMatch(calls[2].prompt!, /FIRST/);
  assert.equal(f.count("commit"), 1);
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const [prefix, suffix] of [
      ["prompt", "md"],
      ["events", "jsonl"],
      ["report", "json"],
      ["agent", "log"],
      ["check", "log"],
    ]) {
      assert.ok(
        existsSync(join(f.directory, `${prefix}-${attempt}.${suffix}`)),
      );
    }
    assert.match(
      f.runLog(),
      new RegExp(
        `attempt=${attempt} thread_id=saved check=${attempt === 3 ? "green" : "red"}`,
      ),
    );
  }
});

test("a lefthook failure resumes and supplies the commit diagnostic", async (t) => {
  const f = fixture(t, { commits: [false, true] });
  await f.launch();
  assert.equal(f.count("commit"), 2);
  assert.match(f.codex()[1].prompt!, /lefthook failed/);
  assert.match(f.runLog(), /attempt=1 .*check=red/);
});

test("only the last 80 lines from the failed attempt are returned", async (t) => {
  const output = Array.from({ length: 100 }, (_, i) => `LINE-${i + 1}\n`).join(
    "",
  );
  const f = fixture(t, { checks: [false, true], outputs: [output] });
  await f.launch();
  const prompt = f.codex()[1].prompt!;
  assert.doesNotMatch(prompt, /LINE-1\n/);
  assert.match(prompt, /LINE-100\n/);
  const diagnostics = prompt
    .split("Последние 80 строк лога этой попытки:\n\n")[1]
    .split("\n\nИсправь")[0];
  assert.equal(diagnostics.split("\n").length, 80);
});

test("fix limit permits exactly the initial attempt plus maxFixAttempts returns", async (t) => {
  const f = fixture(t, { checks: [false, false, false, false] });
  await assert.rejects(f.launch(3), /Fix attempts exhausted for #8 \(3\)/);
  assert.equal(f.codex().length, 4);
  assert.equal(f.count("check"), 4);
  assert.equal(f.count("commit"), 0);
  assert.match(f.runLog(), /attempt=4 .*check=red/);
});

for (const status of ["blocked", "failed"] as const) {
  for (const resumed of [false, true]) {
    test(`${status} after ${resumed ? "resume" : "initial launch"} skips checks and returns unchanged`, async (t) => {
      const f = fixture(t, {
        agents: resumed
          ? [{ threadId: "saved" }, { status }]
          : [{ threadId: "saved", status }],
        checks: [false],
      });
      const report = await f.launch();
      assert.equal(report.status, status);
      assert.equal(f.count("check"), resumed ? 1 : 0);
      assert.equal(f.count("commit"), 0);
      assert.match(f.runLog(), new RegExp(`check=not-run ${status}`));
    });
  }
}
