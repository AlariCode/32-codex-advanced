import { archiveRestore } from "./archive-restore.mjs";
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
let archive;
let restored = false;
let worker;
let workerEnv;
let secondWorker;
let api;
let publicationGate;
const barriers = new Map();
async function kill(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  expectedStops.add(child);
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
}
const retryHits = new Map();
function run(command, args, env = baseEnv, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture)
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} exited ${code}`)),
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
const imageHTML = await readFile(
  resolve(root, "web/tests/fixtures/images.html"),
  "utf8",
);
const imagePNG = await readFile(
  resolve(root, "web/tests/fixtures/images/archive.png"),
);
let fixture;
let fixtureHits = 0;
let forbiddenHits = 0;
async function fixtureOn() {
  if (fixture?.listening) return;
  fixture = createServer((request, response) => {
    fixtureHits++;
    const fixtureURL = new URL(request.url, "http://fixture");
    if (fixtureURL.pathname.startsWith("/barrier/article/")) {
      const key = fixtureURL.pathname.split("/").at(-1);
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        imageHTML.replace(
          "@@IMAGES@@",
          `<figure><img src="http://127.0.0.1:39876/barrier/media/${key}" alt="Controlled image"></figure>`,
        ),
      );
      return;
    }
    if (/^\/barrier\/(html|media)\//.test(fixtureURL.pathname)) {
      const key = fixtureURL.pathname;
      const previous = barriers.get(key);
      const send = () => {
        response.writeHead(200, {
          "Content-Type": key.includes("/media/") ? "image/png" : "text/html",
        });
        response.end(key.includes("/media/") ? imagePNG : html);
      };
      if (previous) {
        previous.hits++;
        send();
      } else {
        const barrier = {
          hits: 1,
          released: false,
          closed: false,
          release: send,
        };
        barriers.set(key, barrier);
        response.on("close", () => {
          barrier.closed = true;
        });
      }
      return;
    }
    if (request.url.startsWith("/archive-fixture/") && archive) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        imageHTML.replace(
          "@@IMAGES@@",
          "<p><strong>Backup strong marker</strong> and <em>Backup emphasis marker</em>.</p>" +
            "<blockquote><p>Backup quote marker</p></blockquote>" +
            "<ul><li>Backup list marker</li></ul><pre><code>backup_code = 42</code></pre>" +
            ["png", "jpeg", "gif"]
              .map(
                (codec, i) =>
                  `<figure><img src="http://127.0.0.1:39876/image-bytes/${codec}" alt="Backup image ${i + 1}"><figcaption>Backup caption ${i + 1}</figcaption></figure>`,
              )
              .join(""),
        ),
      );
      return;
    }
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
  if (
    request.method === "POST" &&
    request.url === "/archive/restore" &&
    archive
  ) {
    if (restored) {
      response.writeHead(409);
      response.end("already restored");
      return;
    }
    restored = true;
    try {
      // Quiesce all writers before taking the PostgreSQL snapshot.
      await kill(worker);
      await kill(api);
      await close(fixture);
      const restoredURL = await archive.restore();
      // The original archive is gone: fallback to the source cannot pass.
      await run(resolve(artifacts, "integration-db"), ["drop", schema]);
      created = false;
      api = start(resolve(artifacts, "api"), [], {
        ...workerEnv,
        DATABASE_URL: restoredURL,
      });
      response.end("restored");
    } catch (error) {
      console.error(error);
      response.writeHead(500);
      response.end("restore failed");
    }
    return;
  }
  const target = new URL(request.url, "http://control");
  if (
    request.method === "POST" &&
    /^\/(worker|worker2|api)\/(on|off|pause|resume)$/.test(target.pathname)
  ) {
    const [, name, action] = target.pathname.split("/");
    let child =
      name === "worker" ? worker : name === "worker2" ? secondWorker : api;
    if (action === "off") {
      await kill(child);
      child = undefined;
    }
    if (action === "on" && !child)
      child = start(
        resolve(artifacts, name === "api" ? "api" : "integration-worker"),
        [],
        workerEnv,
      );
    if (action === "pause") child?.kill("SIGSTOP");
    if (action === "resume") child?.kill("SIGCONT");
    if (name === "worker") worker = child;
    else if (name === "worker2") secondWorker = child;
    else api = child;
    response.end(action);
    return;
  }
  if (request.method === "POST" && target.pathname === "/barrier/release-all") {
    // A failed assertion must not leave the shared worker waiting on a fixture
    // from the previous test. Keep the entries so late/reclaimed requests still
    // pass through the same already-released barrier.
    for (const barrier of barriers.values()) {
      if (barrier.released) continue;
      barrier.released = true;
      if (!barrier.closed) barrier.release();
    }
    response.end("released");
    return;
  }
  if (request.method === "POST" && target.pathname === "/barrier/release") {
    const barrier = barriers.get(target.searchParams.get("key"));
    if (!barrier) {
      response.writeHead(404);
      response.end();
      return;
    }
    barrier.released = true;
    barrier.release();
    response.end("released");
    return;
  }
  if (target.pathname === "/publication/release" && request.method === "POST") {
    await kill(publicationGate);
    publicationGate = undefined;
    response.end("released");
    return;
  }
  if (["/publication/hold", "/link/stats"].includes(target.pathname)) {
    const id = target.searchParams.get("id");
    if (!/^[a-f0-9-]{36}$/.test(id ?? "")) {
      response.writeHead(400);
      response.end();
      return;
    }
    try {
      if (target.pathname === "/link/stats" && request.method === "GET") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          await run(
            resolve(artifacts, "integration-db"),
            ["link-stats", schema, id],
            baseEnv,
            true,
          ),
        );
      } else if (
        target.pathname === "/publication/hold" &&
        request.method === "POST"
      ) {
        if (publicationGate) throw new Error("publication gate already held");
        publicationGate = spawn(
          resolve(artifacts, "integration-db"),
          ["hold-publication", schema, id],
          {
            cwd: root,
            env: baseEnv,
            stdio: ["ignore", "pipe", "inherit"],
          },
        );
        children.push(publicationGate);
        await new Promise((resolve, reject) => {
          publicationGate.once("error", reject);
          publicationGate.once("exit", () =>
            reject(new Error("publication gate exited")),
          );
          publicationGate.stdout.once("data", resolve);
        });
        response.end("held");
      } else {
        response.writeHead(405);
        response.end();
      }
    } catch (error) {
      console.error(error);
      response.writeHead(500);
      response.end();
    }
    return;
  }
  if (request.method === "GET" && request.url.startsWith("/owner/stats?")) {
    const owner = new URL(request.url, "http://control").searchParams.get(
      "user",
    );
    if (!/^[a-f0-9-]{36}$/.test(owner ?? "")) {
      response.writeHead(400);
      response.end();
      return;
    }
    try {
      const output = await run(
        resolve(artifacts, "integration-db"),
        ["owner-stats", schema, owner],
        baseEnv,
        true,
      );
      response.setHeader("Content-Type", "application/json");
      response.end(output);
    } catch {
      response.writeHead(500);
      response.end();
    }
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
        secondWorkerRunning: Boolean(secondWorker),
        barriers: Object.fromEntries(
          [...barriers].map(([key, value]) => [
            key,
            {
              hits: value.hits,
              released: value.released,
              closed: value.closed,
            },
          ]),
        ),
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
  if (archive) {
    try {
      await archive.cleanup();
    } catch (error) {
      console.error("Restore database cleanup failed", error);
      code = 1;
    }
  }
  process.exit(code);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
  if (process.env.ARCHIVE_RESTORE === "1")
    archive = await archiveRestore(root, schema, database);
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
  // The phase acceptance suite exercises a fixed production build. Build with
  // its proxy origin before starting Next; no HMR compilation affects timers.
  await run(
    process.execPath,
    [
      resolve(root, "web/node_modules/next/dist/bin/next"),
      "build",
      resolve(root, "web"),
    ],
    env,
  );
  await fixtureOn();
  await listen(control, 39877);
  api = start(resolve(artifacts, "api"), [], env);
  workerEnv = env;
  worker = start(resolve(artifacts, "integration-worker"), [], env);
  start(
    process.execPath,
    [
      resolve(root, "web/node_modules/next/dist/bin/next"),
      "start",
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
