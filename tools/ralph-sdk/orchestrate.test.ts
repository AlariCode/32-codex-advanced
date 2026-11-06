import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);
const packageRoot = import.meta.dirname;

// Isolated real Git repositories, fake gh/npm/make; no model, network or real issues.
async function fixture(
  deps: Record<number, number[]>,
  failures: number[] = [],
) {
  const tmp = join(packageRoot, "tmp");
  await mkdir(tmp, { recursive: true });
  const base = await mkdtemp(join(tmp, "phase-test-"));
  const root = join(base, "repo");
  const pkg = join(root, "tools", "ralph-sdk");
  const bin = join(base, "bin");
  const runtime = join(pkg, ".ralph");
  await mkdir(runtime, { recursive: true });
  await mkdir(bin);
  await writeFile(
    join(bin, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  await cp(join(packageRoot, "lib"), join(pkg, "lib"), { recursive: true });
  await cp(join(packageRoot, "orchestrate.ts"), join(pkg, "orchestrate.ts"));
  await cp(join(packageRoot, "package.json"), join(pkg, "package.json"));
  await symlink(join(packageRoot, "node_modules"), join(pkg, "node_modules"));
  const git = async (args: string[], cwd = root) =>
    (await exec("git", args, { cwd })).stdout.trim();
  await writeFile(join(root, ".gitignore"), ".ralph/\nnode_modules/\n");
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Phase Test"]);
  await git(["config", "core.hooksPath", "/dev/null"]);
  await git(["add", "."]);
  await git(["commit", "-qm", "fixture"]);
  const issues = Object.fromEntries(
    Object.entries(deps).map(([number, dependencies]) => [
      number,
      {
        number: Number(number),
        title: `Task ${number}`,
        body: dependencies.map((n) => `Зависит от #${n}`).join("\n"),
        url: `https://github.com/test/repo/issues/${number}`,
        state: "OPEN",
      },
    ]),
  );
  await writeFile(join(base, "issues.json"), JSON.stringify(issues));
  for (const number of Object.keys(deps)) {
    const path = join(base, `repo-wt-${number}`);
    await git(["worktree", "add", "-b", `ralph/${number}`, path, "main"]);
    await writeFile(join(path, `task-${number}.txt`), number);
    await git(["add", "."], path);
    await git(["commit", "-qm", `Task ${number} (#${number})`], path);
    const result = {
      issue: Number(number),
      status: "committed",
      commit: await git(["rev-parse", "HEAD"], path),
      rounds: 1,
      tokens: 5,
      branch: `ralph/${number}`,
    };
    await writeFile(
      join(runtime, `result-${number}.json`),
      JSON.stringify(result),
    );
  }
  const scripts = {
    gh: `const fs = require('node:fs');
const base = process.env.FIXTURE_BASE;
if (process.argv[3] === 'view') console.log(JSON.stringify(JSON.parse(fs.readFileSync(base+'/issues.json'))[process.argv[4]]));
else fs.appendFileSync(base+'/comments.jsonl', JSON.stringify(process.argv.slice(2))+'\\n');`,
    npm: `require('node:fs').mkdirSync(require('node:path').join(process.cwd(), process.argv.includes('--prefix') ? 'web/node_modules' : 'node_modules'), {recursive:true});`,
    make: `const fs = require('node:fs');
const number = Number(process.cwd().match(/wt-(\\d+)$/)[1]);
fs.appendFileSync(process.env.FIXTURE_BASE+'/checks.jsonl', JSON.stringify({number,start:true})+'\\n');
setTimeout(() => {
fs.appendFileSync(process.env.FIXTURE_BASE+'/checks.jsonl', JSON.stringify({number,start:false})+'\\n');
process.exit(${JSON.stringify(failures)}.includes(number) ? 1 : 0);
}, 20);`,
  };
  for (const [name, script] of Object.entries(scripts))
    await writeFile(join(bin, name), `#!${process.execPath}\n${script}\n`, {
      mode: 0o755,
    });
  async function run(env = {}) {
    try {
      const result = await exec(
        process.execPath,
        [join(pkg, "orchestrate.ts"), ...Object.keys(deps)],
        {
          cwd: pkg,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FIXTURE_BASE: base,
            PHASE_PARALLEL: "2",
            PHASE_MAX_TOKENS: "100",
            ...env,
          },
        },
      );
      return { code: 0, ...result };
    } catch (error) {
      const result = error as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      return result;
    }
  }
  return {
    base,
    root,
    runtime,
    git,
    run,
    clean: () => rm(base, { recursive: true, force: true }),
  };
}

test("фаза восстанавливает результаты, сливает последовательно и запускает зависимую волну", async () => {
  const f = await fixture({ 21: [], 22: [], 23: [21, 22] });
  try {
    await f.git(["worktree", "remove", join(f.base, "repo-wt-21")]);
    const result = await f.run();
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const journal = JSON.parse(
      await readFile(join(f.runtime, "phase.json"), "utf8"),
    );
    assert.deepEqual(journal.merged.slice(0, 2).sort(), [21, 22]);
    assert.equal(journal.merged[2], 23);
    assert.equal(await f.git(["branch", "--list", "ralph/*"]), "");
    const checks = (await readFile(join(f.base, "checks.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      checks.map((c) => c.start),
      [true, false, true, false, true, false],
    );
    assert.equal(await f.git(["status", "--porcelain"]), "");
    // Repeat after cleanup: the journal alone is sufficient, with no new checks.
    assert.equal((await f.run()).code, 0);
    assert.equal(
      (await readFile(join(f.base, "checks.jsonl"), "utf8")).trim().split("\n")
        .length,
      6,
    );
  } finally {
    await f.clean();
  }
});

test("красная проверка сохраняет worktree, блокирует потомка, остальные сливаются", async () => {
  const f = await fixture({ 21: [], 22: [], 23: [22], 24: [] }, [22]);
  try {
    const result = await f.run();
    assert.equal(result.code, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /Не слиты зависимости: #22/);
    const journal = JSON.parse(
      await readFile(join(f.runtime, "phase.json"), "utf8"),
    );
    assert.deepEqual(journal.merged.sort(), [21, 24]);
    assert.match(await f.git(["worktree", "list"]), /repo-wt-22/);
    assert.match(
      await readFile(join(f.base, "comments.jsonl"), "utf8"),
      /comment.*22/,
    );
  } finally {
    await f.clean();
  }
});

test("бюджет не запускает новые задачи, возобновление после ff завершает очистку", async () => {
  const f = await fixture({ 21: [], 22: [] });
  try {
    // Simulate a crash after ff, before cleanup and phase.json.
    await f.git(["merge", "--ff-only", "ralph/21"]);
    const result = await f.run({ PHASE_PARALLEL: "1", PHASE_MAX_TOKENS: "5" });
    assert.equal(result.code, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /Бюджет фазы исчерпан/);
    const journal = JSON.parse(
      await readFile(join(f.runtime, "phase.json"), "utf8"),
    );
    assert.deepEqual(journal.merged, [21]);
    assert.equal(await f.git(["branch", "--list", "ralph/21"]), "");
  } finally {
    await f.clean();
  }
});

test("конфликт rebase прерывается; независимая задача продолжает сливаться", async () => {
  const f = await fixture({ 21: [], 22: [], 23: [21] });
  try {
    await writeFile(join(f.root, "task-21.txt"), "другое изменение в main");
    await f.git(["add", "."]);
    await f.git(["commit", "-qm", "conflict in main"]);
    const result = await f.run();
    assert.equal(result.code, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /Конфликт rebase/);
    assert.match(result.stdout, /Не слиты зависимости: #21/);
    const journal = JSON.parse(
      await readFile(join(f.runtime, "phase.json"), "utf8"),
    );
    assert.deepEqual(journal.merged, [22]);
    const path = join(f.base, "repo-wt-21");
    assert.equal(await f.git(["branch", "--show-current"], path), "ralph/21");
    assert.equal(await f.git(["status", "--porcelain"], path), "");
  } finally {
    await f.clean();
  }
});
