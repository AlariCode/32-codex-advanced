import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Codex,
  Thread,
  ThreadOptions,
  TurnOptions,
} from "@openai/codex-sdk";
import { ralph } from "./lib/ralph.ts";
import { parseRunArgs } from "./lib/io.ts";

const exec = promisify(execFile);
const finding = (text: string) => ({
  priority: "P1",
  file: "solution.txt",
  line: 1,
  text,
});

async function fixture() {
  await mkdir(join(import.meta.dirname, "tmp"), { recursive: true });
  const root = await mkdtemp(join(import.meta.dirname, "tmp", "recovery-"));
  const stateDirectory = join(root, ".ralph");
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: root })).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.hooksPath", "/dev/null");
  await writeFile(join(root, ".gitignore"), ".ralph/\nbin/\n");
  await git("add", ".");
  await git("commit", "-qm", "initial");
  await writeFile(
    join(bin, "gh"),
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[3] === 'view') console.log(JSON.stringify({number:42,title:'Task',body:'Solve',url:'https://example.com/42'}));
else {
 if (fs.existsSync('.ralph/fail-comment')) process.exit(1);
 fs.appendFileSync('.ralph/comments', 'comment\\n');
}
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "make"),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync('.ralph/checks', 'check\\n');
process.exit(fs.existsSync('.ralph/fail-check') ? 1 : 0);
`,
    { mode: 0o755 },
  );
  const env = { ...process.env };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  delete process.env.RALPH_MAX_REVIEW_ROUNDS;
  process.env.RALPH_MAX_TOKENS = "100";
  process.env.RALPH_TURN_TIMEOUT_MIN = "1";
  let reviews: unknown[][] = [[finding("first")], [finding("latest")]];
  const calls: { id: string; prompt: string; options?: TurnOptions }[] = [];
  const thread = (id: string, options?: ThreadOptions) =>
    ({
      async runStreamed(prompt: string, turnOptions?: TurnOptions) {
        calls.push({ id, prompt, options: turnOptions });
        const review = options?.sandboxMode === "read-only";
        if (!review) await writeFile(join(root, "solution.txt"), prompt);
        return {
          events: (async function* () {
            yield { type: "thread.started", thread_id: id };
            yield {
              type: "item.completed",
              item: {
                type: "agent_message",
                id: "answer",
                text: JSON.stringify(
                  review
                    ? { findings: reviews.shift() ?? [] }
                    : { summary: "Done", files: ["solution.txt"] },
                ),
              },
            };
            yield {
              type: "turn.completed",
              usage: { input_tokens: 2, output_tokens: 1 },
            };
          })(),
        };
      },
    }) as unknown as Thread;
  let next = 0;
  const codex: Pick<Codex, "startThread" | "resumeThread"> = {
    startThread: (options) => thread(`thread-${++next}`, options),
    resumeThread: (id, options) => thread(id, options),
  };
  const run = (extraReviewRounds?: number) =>
    ralph(42, {
      workingDirectory: root,
      stateDirectory,
      codex,
      extraReviewRounds,
      onEvent: () => {},
    });
  const state = async () =>
    JSON.parse(await readFile(join(stateDirectory, "state-42.json"), "utf8"));
  return {
    root,
    stateDirectory,
    calls,
    run,
    state,
    git,
    reviews: (values: unknown[][]) => {
      reviews = values;
    },
    async clean() {
      for (const key of Object.keys(process.env))
        if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("исчерпание сохраняет контекст; явное продолжение исправляет последние P1 и коммитит", async () => {
  const f = await fixture();
  try {
    const stopped = await f.run();
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.rounds, 2);
    assert.equal(stopped.tokens, 12);
    const state = await f.state();
    assert.equal(state.stage, "stopped");
    assert.equal(state.workerThreadId, "thread-1");
    assert.deepEqual(state.findings, [finding("latest")]);
    assert.equal(state.maxReviewRounds, 2);
    assert.match(await f.git("status", "--porcelain"), /solution.txt/);
    const calls = f.calls.length;
    assert.deepEqual(await f.run(), stopped);
    assert.equal(f.calls.length, calls);
    assert.equal(
      (await readFile(join(f.stateDirectory, "comments"), "utf8"))
        .trim()
        .split("\n").length,
      1,
    );
    f.reviews([[]]);
    const resumed = await f.run(2);
    assert.equal(resumed.status, "committed", resumed.reason);
    assert.equal(resumed.rounds, 3);
    assert.equal(resumed.tokens, 18);
    assert.equal(f.calls[calls].id, state.workerThreadId);
    assert.match(f.calls[calls].prompt, /latest/);
    assert.doesNotMatch(f.calls[calls].prompt, /first/);
    assert.notEqual(f.calls[calls + 1].id, f.calls[calls - 1].id);
    assert.equal(
      (await readFile(join(f.stateDirectory, "checks"), "utf8"))
        .trim()
        .split("\n").length,
      3,
    );
    assert.equal(await f.git("status", "--porcelain"), "");
    assert.equal(await f.git("rev-list", "--count", "HEAD"), "2");
    await assert.rejects(f.state(), { code: "ENOENT" });
  } finally {
    await f.clean();
  }
});

test("настраиваемые раунды и повторное исчерпание не сбрасывают usage и ограничения", async () => {
  const f = await fixture();
  try {
    process.env.RALPH_MAX_REVIEW_ROUNDS = "1";
    assert.equal((await f.run()).rounds, 1);
    process.env.RALPH_MAX_REVIEW_ROUNDS = "99";
    process.env.RALPH_MAX_TOKENS = "999";
    process.env.RALPH_TURN_TIMEOUT_MIN = "99";
    const again = await f.run(1);
    assert.equal(again.rounds, 2);
    assert.equal(again.status, "stopped");
    const state = await f.state();
    assert.equal(state.maxReviewRounds, 2);
    assert.equal(state.maxTokens, 100);
    assert.equal(state.timeoutMs, 60_000);
    assert.equal(state.tokens, 12);
    process.env.RALPH_MAX_TOKENS = "12";
    const calls = f.calls.length;
    assert.match((await f.run(1)).reason!, /Бюджет токенов исчерпан/);
    assert.equal(f.calls.length, calls);
    assert.equal((await f.state()).tokens, 12);
  } finally {
    await f.clean();
  }
});

test("после исправления P1 красный make check блокирует ревью и коммит", async () => {
  const f = await fixture();
  try {
    await f.run();
    await writeFile(join(f.stateDirectory, "fail-check"), "");
    const calls = f.calls.length;
    const result = await f.run(1);
    assert.match(result.reason!, /make check не пройден/);
    assert.equal(result.rounds, 2);
    assert.equal(f.calls.length, calls + 3);
    assert.equal(await f.git("rev-list", "--count", "HEAD"), "1");
    assert.deepEqual((await f.state()).findings, [finding("latest")]);
  } finally {
    await f.clean();
  }
});

test("сбой комментария повторяет только публикацию; остановка остаётся на диске", async () => {
  const f = await fixture();
  try {
    await mkdir(f.stateDirectory);
    await writeFile(join(f.stateDirectory, "fail-comment"), "");
    assert.match((await f.run()).reason!, /Комментарий/);
    assert.equal((await f.state()).stage, "comment");
    const calls = f.calls.length;
    await rm(join(f.stateDirectory, "fail-comment"));
    await f.run();
    assert.equal(f.calls.length, calls);
    assert.equal((await f.state()).stage, "stopped");
  } finally {
    await f.clean();
  }
});

test("CLI требует явного номера и положительного числа дополнительных раундов", () => {
  assert.deepEqual(
    parseRunArgs(["--resume", "42", "--extra-review-rounds", "3"]),
    {
      numbers: [42],
      resume: 42,
      extraReviewRounds: 3,
      dryRun: false,
    },
  );
  assert.equal(
    parseRunArgs(
      ["41", "42", "--resume", "42", "--extra-review-rounds", "1"],
      true,
    ).resume,
    42,
  );
  for (const args of [
    ["42", "--resume", "42"],
    ["42", "--extra-review-rounds", "2"],
    ["--resume", "42", "--extra-review-rounds", "0"],
    ["--resume", "42", "--extra-review-rounds", "1.5"],
    ["41", "--resume", "42", "--extra-review-rounds", "2"],
    ["42", "--resume"],
  ])
    assert.throws(() => parseRunArgs(args));
});

test("лимит выше двух проводит исправления между всеми ревью", async () => {
  const f = await fixture();
  try {
    process.env.RALPH_MAX_REVIEW_ROUNDS = "3";
    f.reviews([[finding("first")], [finding("second")], [finding("third")]]);
    const outcome = await f.run();
    assert.equal(outcome.rounds, 3);
    assert.equal(outcome.status, "stopped");
    assert.equal(f.calls.length, 6);
    assert.match(f.calls[2].prompt, /first/);
    assert.match(f.calls[4].prompt, /second/);
    assert.deepEqual((await f.state()).findings, [finding("third")]);
    const checks = await readFile(join(f.stateDirectory, "checks"), "utf8");
    assert.equal(checks.trim().split("\n").length, 3);
  } finally {
    await f.clean();
  }
});

test("невалидное продолжение и настройки не запускают новую реализацию", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.run(1), /Нет сохранённой остановленной попытки/);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(f.run(value), /положительное целое/);
    for (const value of ["0", "-1", "1.5", "invalid"]) {
      process.env.RALPH_MAX_REVIEW_ROUNDS = value;
      await assert.rejects(f.run(), /RALPH_MAX_REVIEW_ROUNDS/);
    }
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.state(), { code: "ENOENT" });
  } finally {
    await f.clean();
  }
});
