import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { command, issueSchema, parseRunArgs, readCommand } from "./lib/io.ts";
import {
  positiveEnv,
  ralph,
  runtimeDirectory,
  type RalphEvent,
  type RalphResult,
} from "./lib/ralph.ts";
import { buildWaves, dependencies } from "./lib/waves.ts";
import { compact } from "./lib/log.ts";

interface Journal {
  baseBranch?: string;
  merged: number[];
  // Checkpoint before merging: restarting must not run the agent twice.
  tasks: Record<string, RalphResult>;
}
interface Row {
  number: number;
  stage: string;
  rounds: number;
  tokens: number;
  last: string;
  outcome?: "слита" | "остановлена" | "не слита" | "не запущена";
  reason?: string;
  started?: number;
  elapsed: number;
}
const journalPath = join(runtimeDirectory, "phase.json");
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function saveJournal(journal: Journal) {
  await writeFile(
    `${journalPath}.tmp`,
    JSON.stringify(journal, null, 2) + "\n",
  );
  await rename(`${journalPath}.tmp`, journalPath);
}
async function assertBase(root: string, baseBranch: string) {
  if (!baseBranch)
    throw new Error(
      "Основная копия должна быть на ветке (detached HEAD не поддерживается)",
    );
  if (
    (await readCommand("git", ["branch", "--show-current"], root)) !==
    baseBranch
  )
    throw new Error(`Основная копия должна быть на ветке ${baseBranch}`);
  if (await readCommand("git", ["status", "--porcelain"], root))
    throw new Error("Основная копия должна быть чистой");
}
async function worktree(root: string, number: number, baseBranch: string) {
  const path = join(dirname(root), `${basename(root)}-wt-${number}`);
  const branch = `ralph/${number}`;
  const list = await readCommand(
    "git",
    ["worktree", "list", "--porcelain"],
    root,
  );
  const entry = list
    .split("\n\n")
    .find((entry) => entry.split("\n").includes(`worktree ${path}`));
  if (entry) {
    if (!entry.split("\n").includes(`branch refs/heads/${branch}`))
      throw new Error(`${path}: ожидалась ветка ${branch}`);
  } else {
    if (await exists(path))
      throw new Error(
        `${path} существует, но не зарегистрирован как worktree; проверьте git worktree repair`,
      );
    const hasBranch =
      (
        await command(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          root,
        )
      ).code === 0;
    await readCommand(
      "git",
      [
        "worktree",
        "add",
        ...(hasBranch ? [] : ["-b", branch]),
        path,
        hasBranch ? branch : baseBranch,
      ],
      root,
    );
  }
  return { path, branch };
}
async function prepare(path: string) {
  // make check uses the root scripts and web's ESLint/tsc. No generation is required.
  // Avoid installing shared Git hooks from the root package's prepare script.
  if (!(await exists(join(path, "node_modules"))))
    await readCommand("npm", ["ci", "--ignore-scripts"], path);
  if (!(await exists(join(path, "web", "node_modules"))))
    await readCommand("npm", ["ci", "--prefix", "web"], path);
}

function lastEvent(event: RalphEvent) {
  if (event.message) return event.message;
  const stream = event.event;
  if (stream && "item" in stream) {
    const item = stream.item;
    if (item.type === "command_execution")
      return `▶ ${compact(item.command, 90)}`;
    if (item.type === "file_change")
      return `✎ ${compact(item.changes.map((c) => c.path).join(", "), 90)}`;
    if (item.type === "agent_message") return compact(item.text, 90);
  }
  return stream?.type;
}
function report(rows: Row[]) {
  const cell = (value: unknown) =>
    compact(String(value ?? "—"), 500).replaceAll("|", "\\|");
  return [
    "| Задача | Итог | Причина | Раунды | Токены | Время |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...rows.map(
      (r) =>
        `| #${r.number} | ${r.outcome} | ${cell(r.reason)} | ${r.rounds} | ${r.tokens} | ${(r.elapsed / 1000).toFixed(1)} с |`,
    ),
    "",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(
      "Использование: npm run phase -- <номер> [<номер> ...] [--dry-run] [--resume <номер> --extra-review-rounds <число>]",
    );
    return;
  }
  const { numbers, resume, extraReviewRounds, dryRun } = parseRunArgs(
    args,
    true,
  );
  // Derive the primary checkout from this package, never from a worktree or cwd.
  const root = await readCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    dirname(runtimeDirectory),
  );
  const baseBranch = await readCommand(
    "git",
    ["branch", "--show-current"],
    root,
  );
  if (!dryRun) await assertBase(root, baseBranch);
  const parallel = positiveEnv("PHASE_PARALLEL", 3);
  const maxTokens = positiveEnv("PHASE_MAX_TOKENS", 9_000_000);
  const journal = await readJson<Journal>(journalPath, {
    baseBranch,
    merged: [],
    tasks: {},
  });
  journal.tasks ??= {};
  // Journals created before baseBranch was recorded always belonged to main.
  const journalBase = journal.baseBranch ?? "main";
  if (journalBase !== baseBranch)
    throw new Error(
      `Журнал фазы относится к ветке ${journalBase}, текущая ветка — ${baseBranch || "detached HEAD"}. Для продолжения переключитесь на ${journalBase}; для новой фазы архивируйте .ralph/ и повторите запуск.`,
    );
  journal.baseBranch = baseBranch;
  if (resume !== undefined && journal.merged.includes(resume))
    throw new Error(`Задача #${resume} уже слита`);
  const load = async (n: number) =>
    issueSchema
      .extend({ state: z.enum(["OPEN", "CLOSED"]) })
      .parse(
        JSON.parse(
          await readCommand(
            "gh",
            [
              "issue",
              "view",
              String(n),
              "--json",
              "number,title,body,url,state",
            ],
            root,
          ),
        ),
      );
  const issues = await Promise.all(numbers.map(load));
  const completed = new Set(journal.merged);
  const graph = issues.map((i) => ({
    number: i.number,
    dependencies: dependencies(i.body),
  }));
  const external = [...new Set(graph.flatMap((i) => i.dependencies))].filter(
    (n) => !numbers.includes(n) && !completed.has(n),
  );
  const outside = await Promise.all(external.map(load));
  for (const issue of [...issues, ...outside])
    if (issue.state === "CLOSED") completed.add(issue.number);
  const plan = buildWaves(graph, completed);
  for (const issue of graph)
    console.log(
      `#${issue.number}: Зависит от: ${issue.dependencies.map((n) => `#${n}`).join(", ") || "нет"}`,
    );
  plan.waves.forEach((wave, index) =>
    console.log(`Волна ${index + 1}: ${wave.map((n) => `#${n}`).join(", ")}`),
  );
  for (const [n, reason] of plan.blocked)
    console.log(`#${n}: не запущена — ${reason}`);
  if (dryRun) return;

  // Include saved usage before scheduling, even when a crash preceded journaling.
  const usage = new Map<number, number>(
    Object.entries(journal.tasks).map(([n, result]) => [
      Number(n),
      result.tokens,
    ]),
  );
  const savedResults = new Map<number, RalphResult>();
  for (const n of numbers) {
    const saved = await readJson<RalphResult | null>(
      join(runtimeDirectory, `result-${n}.json`),
      null,
    );
    const result =
      journal.tasks[n]?.status === "committed" ? journal.tasks[n] : saved;
    if (result) savedResults.set(n, result);
    const state = await readJson<{ tokens: number } | null>(
      join(runtimeDirectory, `state-${n}.json`),
      null,
    );
    usage.set(
      n,
      Math.max(usage.get(n) ?? 0, saved?.tokens ?? 0, state?.tokens ?? 0),
    );
  }
  await mkdir(join(runtimeDirectory, "logs"), { recursive: true });
  await saveJournal(journal);
  const rows: Row[] = numbers.map((number) => ({
    number,
    stage: "ожидает",
    rounds: journal.tasks[number]?.rounds ?? 0,
    tokens: usage.get(number) ?? 0,
    last: "",
    elapsed: 0,
  }));
  const rowByNumber = new Map(rows.map((row) => [row.number, row]));
  const total = () =>
    [...usage].reduce(
      (sum, [n, tokens]) => sum + (rowByNumber.get(n)?.tokens ?? tokens),
      0,
    );
  const log = async (row: Row, event: RalphEvent) => {
    row.stage = event.stage;
    row.rounds = event.round;
    row.tokens = event.tokens;
    row.last = lastEvent(event) ?? row.last;
    await appendFile(
      join(runtimeDirectory, "logs", `${row.number}.jsonl`),
      JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n",
    );
  };
  const stage = (row: Row, name: string, last: string) =>
    log(row, {
      stage: "commit",
      round: row.rounds,
      tokens: row.tokens,
      message: last,
    }).then(() => {
      row.stage = name;
    });
  let lines = 0;
  const render = () => {
    const table = [
      "задача | этап | раунд | токены | последнее событие",
      ...rows.map(
        (r) =>
          `#${r.number} | ${r.outcome ?? r.stage} | ${r.rounds} | ${r.tokens} | ${r.last}`,
      ),
      `фаза: ${total()} из ${maxTokens}`,
    ];
    process.stdout.write(
      `${lines ? `\x1b[${lines}F` : ""}${table.map((line) => `\x1b[2K${line}`).join("\n")}\n`,
    );
    lines = table.length;
  };
  const timer = setInterval(render, 1000);
  render();
  let mergeQueue: Promise<void> = Promise.resolve();
  async function merge(
    row: Row,
    path: string,
    branch: string,
    result: RalphResult,
  ) {
    await assertBase(root, baseBranch);
    await stage(row, "rebase", `▶ git rebase ${baseBranch}`);
    const rebase = await command("git", ["rebase", baseBranch], path);
    if (rebase.code !== 0) {
      const abort = await command("git", ["rebase", "--abort"], path);
      throw new Error(
        `Конфликт rebase: ${rebase.output.trim()}${abort.code ? `; abort: ${abort.output}` : ""}`,
      );
    }
    await stage(row, "check", "▶ make check после rebase");
    const check = await command("make", ["check"], path);
    await writeFile(
      join(runtimeDirectory, "logs", `${row.number}-merge-check.log`),
      check.output,
    );
    if (check.code)
      throw new Error(
        "make check после rebase не пройден (см. лог merge-check)",
      );
    if (await readCommand("git", ["status", "--porcelain"], path))
      throw new Error("Worktree не чистый после make check");
    // Persist the rebased hash so a crash after ff or cleanup can be recovered.
    result.commit = await readCommand("git", ["rev-parse", "HEAD"], path);
    journal.tasks[row.number] = result;
    await saveJournal(journal);
    await assertBase(root, baseBranch);
    await readCommand("git", ["merge", "--ff-only", branch], root);
    await cleanup(row.number, path, branch);
  }
  async function cleanup(number: number, path: string, branch: string) {
    if (await exists(path))
      await readCommand("git", ["worktree", "remove", path], root);
    if (
      (
        await command(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          root,
        )
      ).code === 0
    )
      await readCommand("git", ["branch", "-d", branch], root);
    if (!journal.merged.includes(number)) journal.merged.push(number);
    await saveJournal(journal);
    completed.add(number);
  }
  async function run(row: Row) {
    row.started = Date.now();
    let path = join(dirname(root), `${basename(root)}-wt-${row.number}`);
    const branch = `ralph/${row.number}`;
    try {
      const diskResult = await readJson<RalphResult | null>(
        join(runtimeDirectory, `result-${row.number}.json`),
        null,
      );
      const saved =
        journal.tasks[row.number]?.status === "committed"
          ? journal.tasks[row.number]
          : (diskResult ?? journal.tasks[row.number]);
      const result =
        saved?.status === "committed" &&
        saved.issue === row.number &&
        saved.branch === branch
          ? saved
          : undefined;
      // A crash may have happened after ff, before removing the worktree/journaling.
      const hasBranch =
        (
          await command(
            "git",
            ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
            root,
          )
        ).code === 0;
      const branchMerged =
        !hasBranch ||
        (
          await command(
            "git",
            ["merge-base", "--is-ancestor", branch, baseBranch],
            root,
          )
        ).code === 0;
      if (
        branchMerged &&
        result?.commit &&
        (
          await command(
            "git",
            ["merge-base", "--is-ancestor", result.commit, baseBranch],
            root,
          )
        ).code === 0
      ) {
        row.rounds = result.rounds;
        row.tokens = result.tokens;
        const queued = mergeQueue.then(async () => {
          journal.tasks[row.number] = result;
          await cleanup(row.number, path, branch);
        });
        mergeQueue = queued.catch(() => {});
        await queued;
        row.outcome = "слита";
        return;
      }
      await assertBase(root, baseBranch);
      await stage(row, "подготовка", "▶ git worktree / npm ci");
      ({ path } = await worktree(root, row.number, baseBranch));
      if (
        result?.commit &&
        (
          await command(
            "git",
            ["merge-base", "--is-ancestor", result.commit, "HEAD"],
            path,
          )
        ).code !== 0
      )
        throw new Error(
          `Сохранённый коммит ${result.commit} отсутствует в ${branch}; восстановите ветку из этого коммита или проверьте checkpoint вручную`,
        );
      await prepare(path);
      const outcome =
        result ??
        (await ralph(row.number, {
          workingDirectory: path,
          extraReviewRounds:
            row.number === resume ? extraReviewRounds : undefined,
          onEvent: (event) => log(row, event),
        }));
      row.rounds = outcome.rounds;
      row.tokens = outcome.tokens;
      if (outcome.status !== "committed") {
        row.outcome = "остановлена";
        const queued = mergeQueue.then(async () => {
          journal.tasks[row.number] = outcome;
          await saveJournal(journal);
        });
        mergeQueue = queued.catch(() => {});
        await queued;
        throw new Error(outcome.reason ?? "Ralph остановился");
      }
      // Only this queue mutates the base branch and the phase journal.
      const queued = mergeQueue.then(async () => {
        journal.tasks[row.number] = outcome;
        await saveJournal(journal);
        await merge(row, path, branch, outcome);
      });
      mergeQueue = queued.catch(() => {});
      await stage(row, "очередь слияния", "Ожидает слияния");
      await queued;
      row.outcome = "слита";
      row.last = `✓ коммит ${outcome.commit}`;
    } catch (error) {
      row.outcome ??= "не слита";
      row.reason = message(error);
      const body = `Фаза: задача не слита.\n\nПричина: ${row.reason}\n\nWorktree: ${path}\nВетка: ${branch}\n\nДля продолжения устраните причину в worktree (при остановке Ralph см. tools/ralph-sdk/README.md, раздел восстановления), затем повторите npm run phase -- ${numbers.join(" ")} из tools/ralph-sdk основной копии. После исправления кода в закоммиченной ветке создайте коммит вручную. Push и закрытие issue не выполнялись.`;
      const commentPath = join(
        runtimeDirectory,
        `phase-comment-${row.number}.md`,
      );
      await writeFile(commentPath, body + "\n");
      try {
        await readCommand(
          "gh",
          ["issue", "comment", String(row.number), "--body-file", commentPath],
          root,
        );
      } catch (error) {
        row.reason += `; комментарий не опубликован: ${message(error)}`;
      }
      await appendFile(
        join(runtimeDirectory, "logs", `${row.number}.jsonl`),
        JSON.stringify({
          time: new Date().toISOString(),
          outcome: row.outcome,
          reason: row.reason,
        }) + "\n",
      );
    } finally {
      row.elapsed = Date.now() - row.started;
    }
  }
  try {
    for (const row of rows) {
      if (journal.merged.includes(row.number)) row.outcome = "слита";
      else if (plan.blocked.has(row.number) || completed.has(row.number)) {
        row.outcome = "не запущена";
        row.reason =
          plan.blocked.get(row.number) ?? "Задача уже закрыта в GitHub";
      } else {
        const deps = graph.find((i) => i.number === row.number)!.dependencies;
        row.stage = deps.length
          ? `ждёт ${deps.map((n) => `#${n}`).join(", ")}`
          : "ожидает";
      }
    }
    for (const wave of plan.waves) {
      const pending = wave.map((n) => rowByNumber.get(n)!);
      const active = new Set<Promise<void>>();
      while (pending.length || active.size) {
        while (pending.length && active.size < parallel) {
          const row = pending.shift()!;
          const missing = graph
            .find((i) => i.number === row.number)!
            .dependencies.filter((n) => !completed.has(n));
          const saved = savedResults.get(row.number);
          // Budget exhaustion must not prevent recovery of an already merged commit.
          const cleanupOnly =
            total() >= maxTokens &&
            saved?.status === "committed" &&
            saved.commit &&
            (
              await command(
                "git",
                ["merge-base", "--is-ancestor", saved.commit, baseBranch],
                root,
              )
            ).code === 0;
          if (missing.length || (total() >= maxTokens && !cleanupOnly)) {
            row.outcome = "не запущена";
            row.reason = missing.length
              ? `Не слиты зависимости: ${missing.map((n) => `#${n}`).join(", ")}`
              : "Бюджет фазы исчерпан";
            continue;
          }
          const task = run(row).finally(() => {
            active.delete(task);
          });
          active.add(task);
        }
        if (active.size) await Promise.race(active);
      }
    }
  } finally {
    clearInterval(timer);
    render();
    const final = report(rows);
    await writeFile(join(runtimeDirectory, "phase-report.md"), final);
    console.log("\n" + final);
  }
  if (rows.some((row) => row.outcome !== "слита")) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main().catch((error) => {
    console.error(message(error));
    process.exitCode = 1;
  });
