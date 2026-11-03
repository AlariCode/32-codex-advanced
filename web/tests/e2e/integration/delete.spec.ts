import { expect, test, type Page } from "@playwright/test";
const fixture = "http://127.0.0.1:39876";
const control = "http://127.0.0.1:39877";
async function login(page: Page) {
  const email = `delete-${crypto.randomUUID()}@example.com`;
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
  return page.evaluate(
    async () =>
      (await (await fetch("/api/users/me", { cache: "no-store" })).json())
        .id as string,
  );
}
async function save(page: Page, url: string) {
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const card = page.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
  await expect(card).toBeVisible();
  return card;
}
async function remove(page: Page) {
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
}
test("real archive deletion cascades media and closes another tab reader on return", async ({
  page,
  context,
  request,
}, testInfo) => {
  const owner = await login(page);
  const url = `${fixture}/images/normal/${crypto.randomUUID()}`;
  const card = await save(page, url);
  const read = card.getByRole("link", { name: "Читать статью" });
  await expect(read).toBeVisible({ timeout: 20000 });
  const path = (await read.getAttribute("href"))!;
  const id = path.split("/").pop()!;
  const reader = await context.newPage();
  await reader.goto(path);
  const article = reader.getByRole("article", {
    name: "Сохранённая статья",
    exact: true,
  });
  await expect(article).toBeVisible();
  await expect(article.locator("img")).toHaveCount(3);
  const asset = (await article.locator("img").first().getAttribute("src"))!;
  await page.bringToFront();
  await remove(page);
  await expect(card).toHaveCount(0);
  const stats = await (
    await request.get(`${control}/owner/stats?user=${owner}`)
  ).json();
  expect(stats.links).toBe(0);
  expect(stats.jobs).toBe(0);
  for (const endpoint of [
    `/api/links/${id}`,
    `/api/links/${id}/document`,
    asset,
  ])
    expect(
      await page.evaluate(async (endpoint) => {
        const r = await fetch(endpoint, { cache: "no-store" });
        return { status: r.status, cache: r.headers.get("cache-control") };
      }, endpoint),
    ).toEqual({ status: 404, cache: "no-store" });
  await reader.bringToFront();
  await reader.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(article).toHaveCount(0);
  await expect(reader.getByRole("main").getByRole("alert")).toContainText(
    "Статья не найдена",
  );
  await expect(
    reader.getByRole("link", { name: "Моя библиотека" }),
  ).toBeVisible();
  await reader.screenshot({
    path: testInfo.outputPath("reader-deleted.png"),
    fullPage: true,
  });
  await reader.close();
  const replacement = await save(page, url);
  await expect(
    replacement.getByRole("link", { name: "Читать статью" }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    await replacement
      .getByRole("link", { name: "Читать статью" })
      .getAttribute("href"),
  ).not.toBe(path);
});
test("real DELETE commits while response is lost and metadata reconciliation confirms absence", async ({
  page,
  request,
}) => {
  const owner = await login(page);
  const url = `${fixture}/delay/${crypto.randomUUID()}?ms=15000`;
  const card = await save(page, url);
  await expect(card.getByText("Обрабатываем", { exact: true })).toBeVisible();
  const id = (await card.getAttribute("id"))!.replace("link-", "");
  let verified = false;
  await page.route(`**/api/links/${id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      const committed = await route.fetch();
      expect(committed.status()).toBe(204);
      await route.abort();
    } else {
      verified = true;
      await route.continue();
    }
  });
  await remove(page);
  await expect(card).toHaveCount(0);
  expect(verified).toBe(true);
  const stats = await (
    await request.get(`${control}/owner/stats?user=${owner}`)
  ).json();
  expect(stats.links).toBe(0);
  expect(stats.jobs).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Здесь будут ваши ссылки" }),
  ).toBeVisible();
});
