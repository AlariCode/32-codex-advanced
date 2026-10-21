import { articleFixture } from "./article-fixtures.mjs";
import { imageFixture } from "./image-fixtures.mjs";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = resolve(root, "tmp/integration");
await mkdir(artifacts, { recursive: true });
const database = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable",
);
if (database.pathname !== "/linkbook_test")
  throw new Error("Harness only accepts isolated linkbook_test");
const schema = `e2e_${process.pid}_${Date.now()}`;
const baseEnv = { ...process.env, TEST_DATABASE_URL: database.href };
const children = [];
let stopping = false;
let created = false;
const expectedStops = new WeakSet();
let worker;
let workerEnv;
const retryHits = new Map();
function run(command, args, env = baseEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    detached: false,
  });
  children.push(child);
  child.on("error", () => void stop(1));
  child.on("exit", () => {
    if (!stopping && !expectedStops.has(child)) void stop(1);
  });
  return child;
}
const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
const html = await readFile(resolve(root, "web/tests/fixtures/article.html"));
const formatting = await readFile(
  resolve(root, "web/tests/fixtures/formatting.html"),
);
let fixture;
let fixtureHits = 0;
let forbiddenHits = 0;
async function fixtureOn() {
  if (fixture?.listening) return;
  fixture = createServer((request, response) => {
    fixtureHits++;
    if (articleFixture(request, response)) return;
    if (imageFixture(request, response)) return;
    if (request.url.startsWith("/formatting/")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(formatting);
      return;
    }
    if (request.url.startsWith("/redirect-blocked")) {
      response.writeHead(302, { Location: "http://127.0.0.1:39877/forbidden" });
      response.end();
      return;
    }
    if (request.url.startsWith("/unreachable")) {
      response.writeHead(503);
      response.end();
      return;
    }
    if (request.url.startsWith("/retry-once/")) {
      const count = (retryHits.get(request.url) ?? 0) + 1;
      retryHits.set(request.url, count);
      if (count === 1) {
        response.writeHead(503, { "Retry-After": "35" });
        response.end();
        return;
      }
    }
    if (request.url.startsWith("/delay/")) {
      const milliseconds = Math.min(
        130000,
        Math.max(
          0,
          Number(
            new URL(request.url, "http://fixture").searchParams.get("ms"),
          ) || 0,
        ),
      );
      response.writeHead(200, { "Content-Type": "text/html" });
      response.flushHeaders();
      const timer = setTimeout(() => response.end(html), milliseconds);
      response.on("close", () => clearTimeout(timer));
      return;
    }
    if (request.url.startsWith("/slow")) {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(html);
      }, 3000);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await listen(fixture, 39876);
}
const control = createServer(async (request, response) => {
  if (request.url === "/forbidden") {
    forbiddenHits++;
    response.end("must not be contacted");
    return;
  }
  if (request.method === "POST" && request.url === "/off") {
    await close(fixture);
    response.end("off");
    return;
  }
  if (request.method === "POST" && request.url === "/on") {
    await fixtureOn();
    response.end("on");
    return;
  }
  if (request.method === "POST" && request.url === "/worker/off") {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      expectedStops.add(worker);
      await new Promise((resolve) => {
        worker.once("exit", resolve);
        worker.kill("SIGKILL");
      });
    }
    worker = undefined;
    response.end("worker stopped");
    return;
  }
  if (request.method === "POST" && request.url === "/worker/on") {
    if (!worker)
      worker = start(resolve(artifacts, "integration-worker"), [], workerEnv);
    response.end("worker started");
    return;
  }
  if (request.method === "POST" && request.url.startsWith("/session/expire?")) {
    const owner = new URL(request.url, "http://control").searchParams.get(
      "user",
    );
    if (!/^[a-f0-9-]{36}$/.test(owner ?? "")) {
      response.writeHead(400);
      response.end();
      return;
    }
    try {
      await run(resolve(artifacts, "integration-db"), [
        "expire-sessions",
        schema,
        owner,
      ]);
      response.end("session expired");
    } catch {
      response.writeHead(500);
      response.end();
    }
    return;
  }
  if (request.url === "/stats") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        fixtureHits,
        forbiddenHits,
        workerRunning: Boolean(worker),
        retryHits: Object.fromEntries(retryHits),
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end();
});
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  await Promise.all([close(control), ...(fixture ? [close(fixture)] : [])]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  if (created)
    await run(resolve(artifacts, "integration-db"), ["drop", schema]).catch(
      () => {},
    );
  process.exit(code);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
  await Promise.all(
    [
      ["api", "./backend/api/cmd/api"],
      ["integration-worker", "./backend/worker/cmd/integration-worker"],
      ["integration-db", "./backend/api/cmd/integration-db"],
    ].map(([name, pkg]) =>
      run("go", ["build", "-o", resolve(artifacts, name), pkg]),
    ),
  );
  await run(resolve(artifacts, "integration-db"), ["create", schema]);
  created = true;
  database.searchParams.set("search_path", schema);
  const env = {
    ...baseEnv,
    DATABASE_URL: database.href,
    API_PORT: "18080",
    PUBLIC_ORIGIN: "http://127.0.0.1:3200",
    API_ORIGIN: "http://127.0.0.1:18080",
    FIXTURE_ORIGIN: "http://127.0.0.1:39876",
  };
  await fixtureOn();
  await listen(control, 39877);
  start(resolve(artifacts, "api"), [], env);
  workerEnv = env;
  worker = start(resolve(artifacts, "integration-worker"), [], env);
  start(
    process.execPath,
    [
      resolve(root, "web/node_modules/next/dist/bin/next"),
      "dev",
      resolve(root, "web"),
      "--hostname",
      "127.0.0.1",
      "--port",
      "3200",
    ],
    env,
  );
} catch (error) {
  console.error(error.message);
  await stop(1);
}
