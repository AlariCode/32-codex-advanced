import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = "http://127.0.0.1:39876";
const control = "http://127.0.0.1:39877";
async function login(page: Page) {
  const email = `images-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await page.request.post("/api/users/register", {
        data: { email, password: "ReliableArchive42!" },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("ReliableArchive42!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function open(page: Page, mode: string) {
  const url = `${fixture}/images/${mode}/${crypto.randomUUID()}`;
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const card = page.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
  const read = card.getByRole("link", { name: "Читать статью" });
  await expect(read).toBeVisible({ timeout: 20000 });
  await read.click();
  const article = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await expect(article).toBeVisible();
  return article;
}
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${control}/on`)).ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  await request.post(`${control}/on`);
});

test("private image bytes survive origin shutdown without article subrequests or active payload", async ({
  page,
  request,
  browser,
}, testInfo) => {
  await login(page);
  const external: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== "http://127.0.0.1:3200")
      external.push(r.url());
  });
  const article = await open(page, "normal");
  await expect(article.locator("img")).toHaveCount(3);
  await expect(article.locator("figcaption")).toHaveText([
    "Archive caption 1",
    "Archive caption 2",
    "Archive caption 3",
  ]);
  const sources: string[] = [];
  for (const [i, codec] of ["png", "jpeg", "gif"].entries()) {
    const img = article.locator("img").nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(320);
    const src = (await img.getAttribute("src"))!;
    sources.push(src);
    expect(src).toMatch(/^\/api\/links\/[a-f0-9-]+\/assets\/[a-f0-9]{64}$/);
    const archived = await page.evaluate(async (src) => {
      const r = await fetch(src);
      return {
        status: r.status,
        mime: r.headers.get("content-type"),
        cache: r.headers.get("cache-control"),
        sniff: r.headers.get("x-content-type-options"),
        bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
      };
    }, src);
    expect(archived.status).toBe(200);
    expect(archived.mime).toBe(`image/${codec}`);
    expect(archived.cache).toBe("no-store");
    expect(archived.sniff).toBe("nosniff");
    expect(Buffer.from(archived.bytes)).toEqual(
      await readFile(`tests/fixtures/images/archive.${codec}`),
    );
  }
  const other = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
    viewport: page.viewportSize()!,
    recordVideo: { dir: testInfo.outputPath("other-session") },
  });
  try {
    const p = await other.newPage();
    await login(p);
    expect(
      await p.evaluate(async (src) => (await fetch(src)).status, sources[0]),
    ).toBe(404);
    await other.clearCookies();
    expect(
      await p.evaluate(async (src) => (await fetch(src)).status, sources[0]),
    ).toBe(401);
  } finally {
    await other.close();
  }
  expect((await request.post(`${control}/off`)).ok()).toBeTruthy();
  await page.reload();
  await expect(article).toContainText("This is the final paragraph");
  for (const img of await article.locator("img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(320);
  }
  await expect(article.locator("figcaption")).toHaveCount(3);
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => Object.hasOwn(window, "fixtureAttack")),
  ).toBe(false);
  expect(await article.locator("script,iframe,svg,[onerror]").count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
});

for (const [mode, count, placeholders, reason] of [
  ["single", 1, 1, "размер больше 5 MiB"],
  ["total", 4, 1, "общий предел 20 MiB"],
  ["count", 50, 1, "предел 50 изображений"],
  ["invalid", 1, 3, "формат повреждён или не поддерживается"],
] as const)
  test(`partial illustrated archive: ${mode}`, async ({ page, request }) => {
    await login(page);
    const article = await open(page, mode);
    await expect(article.locator("img")).toHaveCount(count);
    await expect(
      article.getByRole("note").filter({ hasText: "не сохранено:" }),
    ).toHaveCount(placeholders);
    await expect(article).toContainText(reason);
    await expect(article).toContainText(
      "Часть изображений или оформления не сохранена",
    );
    expect((await request.post(`${control}/off`)).ok()).toBeTruthy();
    await page.reload();
    await expect(article).toContainText("This is the final paragraph");
    await expect(article.locator("img")).toHaveCount(count);
    await expect(
      article.getByRole("note").filter({ hasText: "не сохранено:" }),
    ).toHaveCount(placeholders);
    expect(
      (await (await request.get(`${control}/stats`)).json()).forbiddenHits,
    ).toBe(0);
  });
