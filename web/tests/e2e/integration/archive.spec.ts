import { expect, test, type Page } from "@playwright/test";

const fixture = "http://127.0.0.1:39876";
const control = "http://127.0.0.1:39877";
async function login(page: Page) {
  const email = `archive-${crypto.randomUUID()}@example.com`;
  const created = await page.request.post("/api/users/register", {
    data: { email, password: "ReliableArchive42!" },
  });
  expect(created.status()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("ReliableArchive42!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
}
async function save(page: Page, url: string) {
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  return page.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
}
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${control}/on`)).ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  await request.post(`${control}/on`);
});

test("real queue archives complete text and reader survives origin shutdown", async ({
  page,
  request,
}, testInfo) => {
  await login(page);
  const url = `${fixture}/slow/${crypto.randomUUID()}`;
  const card = await save(page, url);
  await expect(card.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  await expect(card.getByRole("heading")).toHaveText(
    "A library beyond the original",
  );
  await page.screenshot({
    path: testInfo.outputPath("library-ready.png"),
    fullPage: true,
  });
  await card.getByRole("link", { name: "Читать статью" }).click();
  const article = page.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await expect(article).toBeVisible();
  await expect(
    article.getByRole("heading", { name: "Keeping the record" }),
  ).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveCount(3);
  await expect(article.locator("pre code")).toHaveText(
    "* {\n  margin: 0;\n  padding: 0;\n}\n",
  );
  await expect(
    article.locator("pre code .hljs-attribute").first(),
  ).toBeVisible();
  await expect(article.locator("blockquote")).toHaveText(
    "A small archive outlasts a broken link.",
  );
  await expect(article).toContainText("A plain sentence remains safe.");
  await expect(article).toContainText("This final paragraph is a marker");
  await expect(article).not.toContainText("Fixture navigation");
  await expect(article).not.toContainText("Fixture footer");
  expect(
    await article.locator("script,iframe,img,svg,object,form").count(),
  ).toBe(0);
  expect(
    await page.evaluate(() => Object.hasOwn(window, "fixtureAttack")),
  ).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
  await page.getByRole("link", { name: "Моя библиотека" }).focus();
  await expect(
    page.getByRole("link", { name: "Моя библиотека" }),
  ).toBeFocused();
  const original = article.getByRole("link", { name: "Открыть оригинал" });
  await expect(original).toHaveAttribute("href", url);
  await expect(original).toHaveAttribute("rel", "noopener noreferrer");
  const before = await article.innerText();
  expect((await request.post(`${control}/off`)).ok()).toBeTruthy();
  let unavailable = false;
  try {
    await request.get(url, { timeout: 1000 });
  } catch {
    unavailable = true;
  }
  expect(unavailable).toBe(true);
  const documentResponse = page.waitForResponse(
    (r) => r.url().endsWith("/document") && r.status() === 200,
  );
  await page.reload();
  const response = await documentResponse;
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(article).toBeVisible();
  expect(await article.innerText()).toBe(before);
  await page.screenshot({
    path: testInfo.outputPath("reader-origin-off.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Моя библиотека" }).click();
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
});

test("worker errors refresh automatically and blocked redirect never contacts sink", async ({
  page,
  request,
}, testInfo) => {
  await login(page);
  const network = await save(
    page,
    `${fixture}/unreachable/${crypto.randomUUID()}`,
  );
  await expect(network).toContainText("Сайт не отдал страницу.", {
    timeout: 15000,
  });
  const blocked = await save(
    page,
    `${fixture}/redirect-blocked/${crypto.randomUUID()}`,
  );
  await expect(blocked).toContainText(
    "Этот адрес недоступен для безопасной загрузки.",
    { timeout: 15000 },
  );
  expect(
    (await (await request.get(`${control}/stats`)).json()).forbiddenHits,
  ).toBe(0);
  let polls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/links/statuses")) polls++;
  });
  await page.waitForTimeout(4500);
  expect(polls).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("library-errors.png"),
    fullPage: true,
  });
});

test("document access is private and expired session hides reader", async ({
  page,
  browser,
}, testInfo) => {
  await login(page);
  const card = await save(page, `${fixture}/article/${crypto.randomUUID()}`);
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  const path = (await card
    .getByRole("link", { name: "Читать статью" })
    .getAttribute("href"))!;
  const id = path.split("/").at(-1)!;
  const other = await browser.newContext({
    baseURL: "http://127.0.0.1:3200",
    viewport: page.viewportSize()!,
    recordVideo: { dir: testInfo.outputPath("other-session") },
  });
  const otherPage = await other.newPage();
  await login(otherPage);
  // Real Chromium sends Secure cookies to the trusted loopback origin. The
  // standalone APIRequestContext uses different HTTP cookie transport rules.
  const privateGet = (path: string) =>
    otherPage.evaluate(async (path) => {
      const response = await fetch(path, { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, path);
  const me = await privateGet("/api/users/me");
  expect(me.status).toBe(200);
  const foreign = await privateGet(`/api${path}/document`);
  const absent = await privateGet(
    "/api/links/12345678-1234-4234-8234-123456789abc/document",
  );
  expect(foreign.status).toBe(404);
  expect(absent.status).toBe(404);
  expect(foreign.body).toEqual(absent.body);
  const statuses = await privateGet(`/api/links/statuses?ids=${id}`);
  expect(statuses.status).toBe(200);
  expect(statuses.body.links).toEqual([]);
  await other.close();
  await card.getByRole("link", { name: "Читать статью" }).click();
  await expect(
    page.getByRole("article", { name: "Сохранённая статья", exact: true }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("article", { name: "Сохранённая статья", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Войдите, чтобы прочитать сохранённую статью."),
  ).toBeVisible();
});
