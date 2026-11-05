import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, type Thread } from "@openai/codex-sdk";
import { z } from "zod";

const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable(),
  url: z.url(),
});

export function parseIssueNumber(args: string[]): number {
  return z
    .tuple([z.string().regex(/^[1-9]\d*$/)])
    .transform(([value]) =>
      z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(Number(value)),
    )
    .parse(args);
}

function command(program: string, args: string[], cwd: string) {
  return new Promise<{ code: number; output: string }>((accept, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal)
        reject(new Error(`${program}: остановлен сигналом ${signal}`));
      else accept({ code: code ?? 1, output });
    });
  });
}

async function readCommand(program: string, args: string[], cwd: string) {
  const result = await command(program, args, cwd);
  if (result.code !== 0) throw new Error(`${program}: ${result.output.trim()}`);
  return result.output.trim();
}

export function compact(text: string, length = 140) {
  const line = text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

const agentRules = `Работай в текущем репозитории и выполни задачу ниже.
Изучи AGENTS.md и относящийся к задаче код. Сохраняй изменения пользователя.
Не запускай make check: эту проверку выполняет внешний раннер после твоего ответа.
Не запускай сам раннер Ralph. Не делай commit, push, PR и не изменяй задачу в GitHub.
В конце кратко опиши результат и оставшиеся проблемы.`;

export async function runTurn(
  thread: Pick<Thread, "runStreamed">,
  prompt: string,
  saveThread: (id: string) => Promise<void>,
  log: (line: string) => void = console.log,
) {
  const { events } = await thread.runStreamed(prompt);
  let completed = false;
  let response = "";
  for await (const event of events) {
    if (event.type === "thread.started") await saveThread(event.thread_id);
    if (event.type === "turn.failed") throw new Error(event.error.message);
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "turn.completed") completed = true;
    if (
      event.type === "item.started" &&
      event.item.type === "command_execution"
    ) {
      log(`  $ ${compact(event.item.command)}`);
    }
    if (event.type !== "item.completed") continue;
    const item = event.item;
    switch (item.type) {
      case "command_execution":
        log(
          `  ${item.exit_code === 0 ? "✓" : "✗"} exit ${item.exit_code ?? "?"}${item.exit_code === 0 ? "" : ` · ${compact(item.aggregated_output)}`}`,
        );
        break;
      case "file_change":
        log(
          `  ${item.status === "completed" ? "✓" : "✗"} файлы: ${compact(item.changes.map((change) => change.path).join(", "))}`,
        );
        break;
      case "agent_message":
        response = item.text;
        log(`  → ${compact(item.text, 240)}`);
        break;
      case "mcp_tool_call":
        log(`  · ${compact(`${item.server}/${item.tool}`)}: ${item.status}`);
        break;
      case "error":
        log(`  ! ${compact(item.message)}`);
        break;
    }
  }
  if (!completed) throw new Error("Поток Codex завершился без turn.completed");
  return response;
}

export async function solve(
  thread: Pick<Thread, "runStreamed">,
  issue: z.infer<typeof issueSchema>,
  saveThread: (id: string) => Promise<void>,
  check: (attempt: number) => Promise<{ code: number; output: string }>,
  log: (line: string) => void = console.log,
) {
  let prompt = `${agentRules}\n\nGitHub #${issue.number}: ${issue.title}\n${issue.url}\n\n${issue.body ?? ""}`;
  let response = "";
  for (let fixes = 0; fixes <= 2; fixes++) {
    log(`\n▶ ${fixes === 0 ? "Решение задачи" : `Исправление ${fixes}/2`}`);
    response = await runTurn(thread, prompt, saveThread, log);
    log("\n▶ make check");
    const result = await check(fixes);
    if (result.code === 0) return { passed: true, fixes, response };
    log(`  ✗ make check: exit ${result.code}`);
    if (fixes === 2) return { passed: false, fixes, response };
    prompt = `${agentRules}\n\nПродолжи решение задачи #${issue.number} в этой же сессии.
Внешняя проверка make check завершилась с кодом ${result.code}.
Исправь причины сбоя. Осталось ходов на исправление: ${2 - fixes}.
Последние 120 строк вывода (не более 24000 символов):\n\n${result.output.split("\n").slice(-120).join("\n").slice(-24000)}`;
  }
  throw new Error("Недостижимое состояние");
}

async function main() {
  let issueNumber: number | undefined;
  let directory: string | undefined;
  let threadId: string | undefined;
  const started = Date.now();
  try {
    try {
      issueNumber = parseIssueNumber(process.argv.slice(2));
    } catch {
      throw new Error(
        "Использование: npm run once -- <положительный номер задачи>",
      );
    }
    const root = await readCommand(
      "git",
      ["rev-parse", "--show-toplevel"],
      process.cwd(),
    );
    const issue = issueSchema.parse(
      JSON.parse(
        await readCommand(
          "gh",
          [
            "issue",
            "view",
            String(issueNumber),
            "--json",
            "number,title,body,url",
          ],
          root,
        ),
      ),
    );
    if (issue.number !== issueNumber)
      throw new Error("GitHub вернул другую задачу");
    await mkdir(join(root, "tmp", "ralph-sdk"), { recursive: true });
    directory = await mkdtemp(
      join(root, "tmp", "ralph-sdk", `issue-${issueNumber}-`),
    );
    const artifacts = directory;
    console.log(
      `\n╭─ Ralph SDK · #${issue.number} ${compact(issue.title)}\n│  ${issue.url}\n╰─ ${root}`,
    );
    console.log(`Артефакты: ${artifacts}`);
    const thread = new Codex().startThread({
      workingDirectory: root,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
    const result = await solve(
      thread,
      issue,
      async (id) => {
        threadId = id;
        await writeFile(
          join(artifacts, "thread.json"),
          JSON.stringify(
            {
              issue: issue.number,
              url: issue.url,
              root,
              thread_id: id,
            },
            null,
            2,
          ) + "\n",
        );
      },
      async (attempt) => {
        const result = await command("make", ["check"], root);
        await writeFile(join(artifacts, `check-${attempt}.log`), result.output);
        return result;
      },
    );
    await writeFile(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          issue: issue.number,
          thread_id: threadId,
          ...result,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `\n${result.passed ? "✅" : "❌"} #${issue.number} · ${result.passed ? "make check пройден" : "make check не пройден, лимит исправлений исчерпан"}`,
    );
    console.log(
      `Исправлений: ${result.fixes}/2 · Время: ${Math.round((Date.now() - started) / 1000)} с`,
    );
    console.log(`Thread: ${threadId ?? "не получен"}\nАртефакты: ${artifacts}`);
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(
      `\n❌ ${issueNumber ? `#${issueNumber}` : "Ralph SDK"} · ${error instanceof Error ? error.message : String(error)}`,
    );
    if (threadId) console.error(`Thread: ${threadId}`);
    if (directory) console.error(`Артефакты: ${directory}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
