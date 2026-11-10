import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3200";
const fixture = "http://127.0.0.1:39876";
const password = "RestoreArchive42!";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
}

test("dump restores a private readable archive after destroying the source", async ({
  page,
  request,
  browser,
}, info) => {
  const owner = `restore-owner-${crypto.randomUUID()}@example.com`;
  const other = `restore-other-${crypto.randomUUID()}@example.com`;
  const ids: string[] = [];
  for (const email of [other, owner]) {
    const response = await request.post("/api/users/register", {
      data: { email, password },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  await login(page, owner);
  const url = `${fixture}/archive-fixture/${crypto.randomUUID()}`;
  const saved = await page.request.post("/api/links", {
    data: { url },
    headers: { Origin: origin },
  });
  expect(saved.status()).toBe(201);
  // Discover the ID through the real library rather than database fixtures.
  await page.goto("/");
  const card = page.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
  const read = card.getByRole("link", { name: "Читать статью" });
  await expect(read).toBeVisible({ timeout: 20000 });
  const readerPath = (await read.getAttribute("href"))!;
  const id = readerPath.split("/").at(-1)!;
  const documentPath = `/api/links/${id}/document`;
  const beforeResponse = await page.request.get(documentPath);
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  await read.click();
  const article = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await expect(article.locator("img")).toHaveCount(3);
  const originalText = await article.innerText();
  const sources = await article
    .locator("img")
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")!));
  const hashes: string[] = [];
  for (const [i, codec] of ["png", "jpeg", "gif"].entries()) {
    const response = await page.request.get(sources[i]);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes).toEqual(
      await readFile(`tests/fixtures/images/archive.${codec}`),
    );
    hashes.push(createHash("sha256").update(bytes).digest("hex"));
  }
  expect(
    (await request.post("http://127.0.0.1:39877/archive/restore")).status(),
  ).toBe(200);
  await expect
    .poll(async () => {
      try {
        return (await request.get("/api/users/me")).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  // The fixture socket is closed, not just intercepted by Playwright.
  await expect(request.get(url, { timeout: 2000 })).rejects.toThrow();
  await page.context().clearCookies();
  await login(page, owner); // Fresh session validates the restored password hash.
  expect((await (await page.request.get("/api/users/me")).json()).id).toBe(
    ids[1],
  );
  const restored = await page.request.get(documentPath);
  expect(restored.status()).toBe(200);
  expect(await restored.json()).toEqual(before);
  const external: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) external.push(r.url());
  });
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(readerPath);
    await expect(article).toBeVisible();
    await expect(article).toHaveText(originalText, { useInnerText: true });
    await expect(article.locator("strong")).toContainText(
      "Backup strong marker",
    );
    await expect(article.locator("em")).toContainText("Backup emphasis marker");
    await expect(article.locator("blockquote")).toContainText(
      "Backup quote marker",
    );
    await expect(article.locator("li")).toContainText("Backup list marker");
    await expect(article.locator("pre code")).toContainText("backup_code = 42");
    await expect(article.locator("figcaption")).toHaveText(
      [1, 2, 3].map((i) => `Backup caption ${i}`),
    );
    for (let i = 0; i < 3; i++) {
      const img = article.locator("img").nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBe(320);
      expect(await img.getAttribute("src")).toBe(sources[i]);
      const response = await page.request.get(sources[i]);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      ).toBe(hashes[i]);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({
      path: info.outputPath(`reader-${width}.png`),
      fullPage: true,
    });
  }
  expect(external).toEqual([]);
  const outsider = await browser.newContext({ baseURL: origin });
  try {
    const p = await outsider.newPage();
    await login(p, other); // This user must also have survived the dump.
    expect((await (await p.request.get("/api/users/me")).json()).id).toBe(
      ids[0],
    );
    for (const path of [`/api/links/${id}`, documentPath, ...sources])
      expect((await p.request.get(path)).status()).toBe(404);
    expect(
      JSON.stringify(await (await p.request.get("/api/links")).json()),
    ).not.toContain(id);
    await p.goto(readerPath);
    await expect(
      p.getByRole("article", { name: "Сохранённая статья", exact: true }),
    ).toHaveCount(0);
    await outsider.clearCookies();
    for (const path of [
      "/api/links",
      `/api/links/${id}`,
      documentPath,
      ...sources,
    ])
      expect((await p.request.get(path)).status()).toBe(401);
    await p.goto(readerPath);
    await expect(p).toHaveURL(/\/login/);
    await expect(
      p.getByRole("article", { name: "Сохранённая статья", exact: true }),
    ).toHaveCount(0);
  } finally {
    await outsider.close();
  }
  await writeFile(
    info.outputPath("checksums.json"),
    JSON.stringify({ id, sources, sha256: hashes }, null, 2),
  );
});
