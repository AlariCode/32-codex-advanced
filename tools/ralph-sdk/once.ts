import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import { attempt } from "./lib/attempt.ts";
import { loadIssue, parseIssueNumber, readCommand } from "./lib/io.ts";
import { compact } from "./lib/log.ts";

async function main() {
  let directory: string | undefined;
  let threadId: string | undefined;
  try {
    const number = parseIssueNumber(process.argv.slice(2));
    const root = await readCommand(
      "git",
      ["rev-parse", "--show-toplevel"],
      process.cwd(),
    );
    const issue = await loadIssue(number, root);
    await mkdir(join(root, "tmp", "ralph-sdk"), { recursive: true });
    directory = await mkdtemp(
      join(root, "tmp", "ralph-sdk", `issue-${number}-`),
    );
    console.log(
      `\n▶ #${number} ${compact(issue.title)}\nАртефакты: ${directory}`,
    );
    const result = await attempt(issue, new Codex(), {
      root,
      directory,
      saveThread: async (id) => {
        threadId = id;
        await writeFile(
          join(directory!, "thread.json"),
          JSON.stringify(
            { issue: number, url: issue.url, root, thread_id: id },
            null,
            2,
          ) + "\n",
        );
      },
    });
    console.log(
      `\n${result.checkOk ? "✅" : "❌"} #${number} · make check ${result.checkOk ? "пройден" : "не пройден"}`,
    );
    console.log(
      `Исправлений: ${result.fixes}/2\nThread: ${threadId}\nОтчёт: ${JSON.stringify(result.report)}\nАртефакты: ${directory}`,
    );
    if (!result.checkOk) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (threadId) console.error(`Thread: ${threadId}`);
    if (directory) console.error(`Артефакты: ${directory}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
