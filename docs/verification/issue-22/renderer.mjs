import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(path.resolve("web/node_modules/playwright/index.mjs")).href
);
const dir = process.argv[2];
if (!dir)
  throw Error(
    "Usage: node docs/verification/issue-22/renderer.mjs RESULT_DIR [NEXT_ORIGIN]",
  );
const base = process.argv[3] ?? "http://127.0.0.1:3200";
await fs.mkdir(path.join(dir, "visual"), { recursive: true });
const rows = (await fs.readFile(path.join(dir, "runs.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
const browser = await chromium.launch();
const out = [];
for (const row of rows.filter((r) => r.repetition === 1)) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const archive = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", row.article + "-1.json")),
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/users/me")
      return route.fulfill({
        json: { id: row.userId, email: "quality@example.test" },
      });
    if (url.pathname.endsWith("/document"))
      return route.fulfill({ json: archive });
    const asset = row.assets.find((a) =>
      url.pathname.endsWith("/" + a.assetId),
    );
    if (asset)
      return route.fulfill({
        body: await fs.readFile(path.join(dir, "artifacts", asset.assetId)),
        contentType: asset.type,
      });
    return route.fulfill({ status: 404, json: { code: "not_found" } });
  });
  await page.goto(new URL("/links/" + row.cardId, base).href);
  const reader = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await reader.waitFor();
  await reader
    .locator("details")
    .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
  await reader
    .locator("img")
    .evaluateAll((ns) => ns.forEach((n) => (n.loading = "eager")));
  await page.waitForFunction(() =>
    [...document.querySelectorAll("article img")].every(
      (n) => n.complete && n.naturalWidth > 0,
    ),
  );
  const images = await reader.locator("img").evaluateAll((ns) =>
    ns.map((n) => ({
      src: n.getAttribute("src"),
      width: n.naturalWidth,
      height: n.naturalHeight,
    })),
  );
  const text = await reader.innerText();
  await fs.writeFile(
    path.join(dir, "visual", row.article + "-rendered.txt"),
    text,
  );
  await page.screenshot({
    path: path.join(dir, "visual", row.article + "-loaded-reader.png"),
    fullPage: true,
  });
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (const [part, y] of [
    ["top", 0],
    ["middle", Math.floor(height / 2)],
    ["bottom", height - 1000],
  ]) {
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), y);
    await page.screenshot({
      path: path.join(dir, "visual", row.article + "-loaded-" + part + ".png"),
    });
  }
  out.push({
    article: row.article,
    images,
    renderedTextCharacters: text.length,
    detailsOpened: await reader.locator("details").count(),
    note: "Replay of exported document and exact archived bytes in unchanged production renderer; original private HTTP status checked by live benchmark.",
  });
  await context.close();
}
await browser.close();
await fs.writeFile(
  path.join(dir, "quality-renderer.json"),
  JSON.stringify(out, null, 2),
);
console.log(out.map((r) => [r.article, r.images.length, r.detailsOpened]));
