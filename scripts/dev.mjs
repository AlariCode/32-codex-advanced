import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const children = new Set();
const shutdown = new AbortController();
let stopping = false;

function start(target) {
  shutdown.signal.throwIfAborted();
  const child = spawn("make", [target], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.add(child);

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      children.delete(child);
      reject(
        new Error(`Не удалось запустить make ${target}: ${error.message}`),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        children.delete(child);
        resolve();
      } else {
        reject(new Error(`make ${target} завершился: ${signal ?? code}`));
      }
    });
  });
}

function signalGroups(signal) {
  for (const { pid } of children) {
    if (!pid) continue;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  shutdown.abort();
  signalGroups("SIGTERM");
  if (children.size) await delay(5_000);
  signalGroups("SIGKILL");
  process.exit(code);
}

async function waitForAPI() {
  const url = `http://127.0.0.1:${process.env.API_PORT || 8080}/healthz`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const signal = AbortSignal.any([
      shutdown.signal,
      AbortSignal.timeout(1_000),
    ]);
    const response = await fetch(url, { signal }).catch(() => null);
    if (response) {
      await response.body?.cancel();
      if (response.ok) return;
    }
    await delay(300, undefined, { signal: shutdown.signal });
  }
  throw new Error(`API не ответил за 120 секунд: ${url}`);
}

process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));

try {
  if (
    !existsSync(".env") ||
    !existsSync("node_modules/.bin/lefthook") ||
    !existsSync("web/node_modules/.bin/next")
  ) {
    await start("setup");
  }
  await start("db-up");

  const services = (async () => {
    await waitForAPI();
    await Promise.race([start("worker"), start("web")]);
  })();

  await Promise.race([start("api"), services]);
  if (!stopping) throw new Error("Один из сервисов завершился.");
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    await stop(1);
  }
}
