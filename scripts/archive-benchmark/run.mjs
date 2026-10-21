import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { CORPUS, REPETITIONS } from "./corpus.mjs";
import { elapsedMS, markdown, summarize } from "./metrics.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output")) {
  throw new Error(
    "Usage (repository root): npm run benchmark:archive -- --output PATH",
  );
}
const output = path.resolve(
  root,
  args[1] ??
    `tmp/archive-benchmark/${new Date().toISOString().replaceAll(":", "-")}`,
);
// Never append to or overwrite a previous evidence set.
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const artifacts = path.join(output, "artifacts");
await mkdir(artifacts);
const log = createWriteStream(path.join(output, "services.log"));
const children = [];
const database = new URL(
  process.env.TEST_DATABASE_URL ??
    "postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable",
);
if (
  database.pathname !== "/linkbook_test" ||
  !["127.0.0.1", "localhost"].includes(database.hostname)
)
  throw new Error("Only isolated local linkbook_test is allowed");
const schema = `e2e_benchmark_${randomUUID().replaceAll("-", "")}`;
const baseEnv = { ...process.env, TEST_DATABASE_URL: database.href };
const rows = [];
let browser,
  created = false,
  stopping = false;
const startedAt = new Date().toISOString();

function command(program, argv, env = baseEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, argv, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${program} exited ${code}; see services.log`)),
    );
  });
}
function start(program, argv, env) {
  const child = spawn(program, argv, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (error) => log.write(`${error.message}\n`));
  children.push(child);
  return child;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const number = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return number;
}
async function waitURL(url, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      /* startup */
    }
    await pause(250);
  }
  throw new Error(`Service not ready: ${url}`);
}
function version(program, argv) {
  try {
    return execFileSync(program, argv, {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
    }).trim();
  } catch {
    return "unavailable";
  }
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function api(page, route) {
  return page.evaluate(async (route) => {
    const response = await fetch(route);
    return { status: response.status, body: await response.json() };
  }, route);
}

function blocks(document) {
  const all = [];
  const visit = (items) => {
    for (const item of items ?? []) {
      all.push(item);
      visit(item.children);
    }
  };
  visit(document?.blocks);
  return all;
}

async function validate(page, id) {
  const response = await api(page, `/api/links/${id}/document`);
  if (response.status !== 200)
    throw new Error(`Document HTTP ${response.status}`);
  const archive = response.body;
  const all = blocks(archive.document);
  const images = all.filter((b) => b.kind === "image");
  const text = all
    .map((b) => b.text ?? "")
    .join(" ")
    .trim();
  const warnings = archive.warnings ?? [];
  const assetIds = [
    ...new Set(images.filter((b) => b.asset_id).map((b) => b.asset_id)),
  ];
  const assets = [];
  for (const assetId of assetIds) {
    // Fetch only private archived image bytes, never source URLs.
    if (!/^[a-f0-9]{64}$/.test(assetId))
      throw new Error("Invalid private asset identifier");
    assets.push(
      await page.evaluate(
        async ({ id, assetId }) => {
          const response = await fetch(`/api/links/${id}/assets/${assetId}`);
          const bytes = await response.arrayBuffer();
          return {
            assetId,
            status: response.status,
            bytes: bytes.byteLength,
            type: response.headers.get("content-type"),
          };
        },
        { id, assetId },
      ),
    );
  }
  const omitted = images.filter((b) => b.omission).length;
  const mediaComplete =
    !warnings.includes("images_pending") &&
    images.every((b) => Boolean(b.asset_id) !== Boolean(b.omission)) &&
    assets.every(
      (a) => a.status === 200 && a.bytes > 0 && /^image\//.test(a.type ?? ""),
    ) &&
    (omitted === 0 || warnings.includes("images_omitted"));
  await page.goto(new URL(`/links/${id}`, page.url()).href);
  const reader = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await reader.waitFor({ state: "visible", timeout: 15_000 });
  const renderedText = (await reader.innerText()).trim();
  return {
    archive,
    assets,
    documentUsable:
      [1, 2].includes(archive.document?.schema_version) &&
      text.length > 0 &&
      renderedText.length > 0,
    mediaComplete,
    warnings,
    omittedImages: omitted,
    imagePositions: images.length,
    documentSHA256: digest(JSON.stringify(archive.document)),
    textCharacters: text.length,
  };
}

async function measure(baseURL, source, repetition) {
  const row = {
    article: source.id,
    url: source.url,
    repetition,
    state: "not_saved",
    httpStatus: null,
    created: false,
    generation: null,
    confirmedAt: null,
    displayedAt: null,
    elapsedMS: null,
    documentUsable: false,
    mediaComplete: false,
    loadBefore: os.loadavg(),
    startedAt: new Date().toISOString(),
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  try {
    await page.addInitScript(() => {
      window.__archiveBenchmark = {};
      const scan = () => {
        for (const card of document.querySelectorAll('article[id^="link-"]')) {
          const status = card
            .querySelector('[role="status"]')
            ?.textContent?.trim();
          const state = {
            Готово: "ready",
            "Ошибка обработки": "failed",
            "Текст статьи недоступен": "unavailable",
          }[status];
          if (!state || window.__archiveBenchmark[card.id]) continue;
          if (state === "ready" && !card.querySelector('a[href^="/links/"]'))
            continue;
          window.__archiveBenchmark[card.id] = {
            state,
            at: performance.timeOrigin + performance.now(),
            visibility: document.visibilityState,
          };
        }
      };
      new MutationObserver(scan).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await page.goto(`${baseURL}/register`);
    // Account setup is outside measurement; all writes still use the real browser/API.
    const account = await page.evaluate(
      async ({ email, password }) => {
        const response = await fetch("/api/users/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return { status: response.status, body: await response.json() };
      },
      {
        email: `benchmark-${randomUUID()}@example.com`,
        password: `Benchmark-${randomUUID()}!`,
      },
    );
    if (account.status !== 201)
      throw new Error(`Account setup HTTP ${account.status}`);
    row.userId = account.body.id;
    await page.goto(baseURL);
    await page
      .getByRole("heading", { name: "Моя библиотека", exact: true })
      .waitFor();
    await page.getByLabel("Ссылка на статью", { exact: true }).fill(source.url);
    const confirmed = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/links" &&
        r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page
      .getByRole("button", { name: "Сохранить ссылку", exact: true })
      .click();
    const response = await confirmed;
    row.httpStatus = response.status();
    const payload = await response.json();
    row.ackReceivedAt = await page.evaluate(
      () => performance.timeOrigin + performance.now(),
    );
    row.ackServerTime = payload.server_time ?? null;
    row.created = payload.created === true;
    if (row.httpStatus !== 201 || !row.created)
      throw new Error(`Save was not new: HTTP ${row.httpStatus}`);
    row.cardId = payload.link.id;
    row.generation = payload.link.generation;
    row.confirmedAt = payload.link.requested_at;
    row.deadlineAt = payload.link.deadline_at;
    row.state = "processing";
    await page.waitForFunction(
      (id) => Boolean(window.__archiveBenchmark[`link-${id}`]),
      row.cardId,
      { timeout: 130_000 },
    );
    const observed = await page.evaluate(
      (id) => window.__archiveBenchmark[`link-${id}`],
      row.cardId,
    );
    row.state = observed.state;
    row.displayedAt = observed.at;
    row.visibilityAtObservation = observed.visibility;
    row.elapsedMS = elapsedMS(row.confirmedAt, row.displayedAt);
    const current = await api(page, `/api/links/${row.cardId}`);
    row.reason = current.body.reason;
    if (row.state === "ready") {
      const checked = await validate(page, row.cardId);
      const { archive, ...metadata } = checked;
      Object.assign(row, metadata);
      if (observed.visibility !== "visible") {
        row.documentUsable = false;
        row.error = "Browser was not visible when ready was observed";
      }
      const archivePath = path.join(
        artifacts,
        `${source.id}-${repetition}.json`,
      );
      await writeFile(archivePath, JSON.stringify(archive, null, 2));
      if (repetition === 1)
        await page.screenshot({
          path: path.join(artifacts, `${source.id}-reader.png`),
          fullPage: true,
        });
    }
  } catch (error) {
    row.error = error.message;
    if (row.state === "processing") row.state = "observation_error";
    await page
      .screenshot({
        path: path.join(artifacts, `${source.id}-${repetition}-error.png`),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    row.loadAfter = os.loadavg();
    row.endedAt = new Date().toISOString();
    await context.close();
  }
  return row;
}

async function sourceSnapshot(source) {
  const evidence = {
    id: source.id,
    url: source.url,
    fetchedAt: new Date().toISOString(),
  };
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(30_000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    Object.assign(evidence, {
      status: response.status,
      finalURL: response.url,
      sha256: digest(body),
      bytes: body.length,
    });
    await writeFile(path.join(artifacts, `${source.id}-source.html`), body);
  } catch (error) {
    evidence.error = error.message;
  }
  await writeFile(
    path.join(artifacts, `${source.id}-source.json`),
    JSON.stringify(evidence, null, 2),
  );
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await browser?.close().catch(() => {});
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* exited */
    }
  }
  await pause(1000);
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* exited */
    }
  }
  if (created)
    await command(path.join(output, "integration-db"), ["drop", schema]).catch(
      (error) => log.write(`Cleanup: ${error.message}\n`),
    );
  log.end();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await cleanup();
    process.exit(130);
  });

try {
  // Explicit live command only. Ordinary make check never invokes this driver.
  await command("docker", [
    "compose",
    "-f",
    "compose.test.yaml",
    "up",
    "-d",
    "--wait",
    "postgres-test",
  ]);
  const apiPort = await port(),
    webPort = await port();
  const baseURL = `http://127.0.0.1:${webPort}`;
  // Next embeds API_ORIGIN during build; never reuse a build for another port.
  const buildEnv = { ...baseEnv, API_ORIGIN: `http://127.0.0.1:${apiPort}` };
  await command("make", ["build"], buildEnv);
  await command("go", [
    "build",
    "-o",
    path.join(output, "integration-db"),
    "./backend/api/cmd/integration-db",
  ]);
  await command(path.join(output, "integration-db"), ["create", schema]);
  created = true;
  database.searchParams.set("search_path", schema);
  const env = {
    ...buildEnv,
    DATABASE_URL: database.href,
    API_PORT: String(apiPort),
    PUBLIC_ORIGIN: baseURL,
  };
  start(path.join(root, "bin/api"), [], { ...env, GOMAXPROCS: "2" });
  await waitURL(`http://127.0.0.1:${apiPort}/healthz`);
  start(path.join(root, "bin/worker"), [], {
    ...env,
    GOMAXPROCS: "1",
    GOMEMLIMIT: "384MiB",
  });
  start(
    process.execPath,
    [
      path.join(root, "web/node_modules/next/dist/bin/next"),
      "start",
      path.join(root, "web"),
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    env,
  );
  await waitURL(`${baseURL}/register`);
  browser = await chromium.launch({ headless: true });
  const environment = {
    startedAt,
    measuredFrom:
      "server requested_at to first visible DOM ready/card observation",
    clocks: "API and browser on same host",
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    physicalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    loadStart: os.loadavg(),
    node: process.version,
    go: version("go", ["version"]),
    chromium: browser.version(),
    next: JSON.parse(
      await readFile(
        path.join(root, "web/node_modules/next/package.json"),
        "utf8",
      ),
    ).version,
    readeck: "v2.1.3 (backend/worker/go.mod)",
    gitCommit: version("git", ["rev-parse", "HEAD"]),
    dirtyFiles: version("git", ["status", "--short"]),
    driverSHA256: digest(await readFile(fileURLToPath(import.meta.url))),
    corpusSHA256: digest(JSON.stringify(CORPUS)),
    apiBinarySHA256: digest(await readFile(path.join(root, "bin/api"))),
    workerBinarySHA256: digest(await readFile(path.join(root, "bin/worker"))),
    nextBuildID: (
      await readFile(path.join(root, "web/.next/BUILD_ID"), "utf8")
    ).trim(),
    workerConcurrency: 1,
    saveConcurrency: 1,
    independentAccounts: true,
    workerGOMAXPROCS: 1,
    workerGOMEMLIMIT: "384MiB",
    resourceIsolation:
      "host processes; no CPU quota, no container worker firewall; normal safehttp.New with SSRF checks; test PostgreSQL in Docker",
    apiGOMAXPROCS: 2,
    viewport: { width: 1440, height: 900 },
    pollingMS: 2000,
    productionNextBuild: true,
    database: {
      host: database.hostname,
      port: database.port,
      database: "linkbook_test",
      schema,
    },
    postgres: version("docker", [
      "compose",
      "-f",
      "compose.test.yaml",
      "exec",
      "-T",
      "postgres-test",
      "postgres",
      "--version",
    ]),
    network: {
      throttling: false,
      browserProxy: "none configured",
      workerProxy: "safehttp production configuration",
      publicInternet: true,
      httpProxyEnvironmentPresent: Boolean(
        process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
      ),
      connectionType: "not instrumented",
      CDNCache: "uncontrolled; unchanged URLs; no cache busting",
    },
    corpus: CORPUS,
    repetitions: REPETITIONS,
  };
  await writeFile(
    path.join(output, "environment.json"),
    JSON.stringify(environment, null, 2),
  );
  for (const source of CORPUS) {
    for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
      const row = await measure(baseURL, source, repetition);
      rows.push(row);
      await appendFile(
        path.join(output, "runs.jsonl"),
        JSON.stringify(row) + "\n",
      );
      const report = { startedAt, environment, summary: summarize(rows), rows };
      await writeFile(
        path.join(output, "report.json"),
        JSON.stringify(report, null, 2),
      );
      await writeFile(path.join(output, "report.md"), markdown(report));
      console.log(
        `${rows.length}/60 ${source.id} #${repetition}: ${row.state} ${row.elapsedMS ?? "n/a"}ms ${row.error ?? ""}`,
      );
    }
    // Quality snapshots are collected AFTER this source's ten timing samples.
    await sourceSnapshot(source);
  }
  console.log(
    `Report: ${output}; ${summarize(rows).readyWithin15s}/60 within 15s (required 54)`,
  );
} finally {
  await cleanup();
}
