import { expect, test, type Page } from "@playwright/test";
const control = "http://127.0.0.1:39877";
const password = "RecoveryArchive42!";
async function create(page: Page) {
  const email = `phase3-${crypto.randomUUID()}@example.com`;
  const response = await page.request.post("/api/users/register", {
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  const user = await response.json();
  return { ...user, email };
}
async function login(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
async function session(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/users/me");
    return r.json();
  });
}
const input = (page: Page) =>
  page.getByLabel("Ссылка на статью", { exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "Сохранить ссылку", exact: true });

test("real committed POST lost before response is reconciled after reload with one job and generation", async ({
  page,
  request,
}) => {
  const user = await create(page);
  await page.goto("/login");
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  const owner = await session(page);
  const url = `http://127.0.0.1:39876/slow/${crypto.randomUUID()}`;
  let committed = false;
  await page.route("**/api/links", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = true;
    await route.abort();
  });
  await input(page).fill(url);
  await save(page).click();
  await expect(page.getByText(/Исход отправки неизвестен/)).toBeVisible();
  expect(committed).toBe(true);
  await page.reload();
  await expect(page.getByText(/Исход отправки неизвестен/)).toBeVisible();
  await page.unroute("**/api/links");
  await page
    .getByRole("button", { name: "Повторить отправку", exact: true })
    .click();
  await expect(
    page.getByText("Ссылка уже сохранена", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  const stats = await request.get(`${control}/owner/stats?user=${owner.id}`);
  expect(stats.ok()).toBeTruthy();
  expect(await stats.json()).toEqual({ links: 1, jobs: 1, generation: 1 });
  expect(
    await page.evaluate(
      (owner) => localStorage.getItem(`linkbook:drafts:v1:${owner}`),
      owner.id,
    ),
  ).toBeNull();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
});

test("real session expiry while polling returns to library and processing survives", async ({
  page,
  request,
}) => {
  const user = await create(page);
  await page.goto("/login");
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  const owner = await session(page);
  const url = `http://127.0.0.1:39876/slow/${crypto.randomUUID()}`;
  await input(page).fill(url);
  await save(page).click();
  await expect(
    page.getByText("Ссылка сохранена", { exact: true }),
  ).toBeVisible();
  expect(
    (await request.post(`${control}/session/expire?user=${owner.id}`)).ok(),
  ).toBeTruthy();
  await expect(page).toHaveURL(/\/login\?returnTo=%2F$/, { timeout: 10000 });
  await expect(page.getByRole("article")).toHaveCount(0);
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
});

test("real reader return rechecks ownership and Back never reveals former account drafts or article", async ({
  page,
  request,
}) => {
  const user = await create(page);
  await page.goto("/login");
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  const owner = await session(page);
  await input(page).fill(`http://127.0.0.1:39876/slow/${crypto.randomUUID()}`);
  await save(page).click();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  await input(page).fill("https://example.com/private-draft");
  await page.getByRole("link", { name: "Читать статью" }).click();
  await expect(page).toHaveURL(/\/links\/[a-f0-9-]+$/);
  const path = new URL(page.url()).pathname;
  await expect(page.getByRole("article")).toBeVisible();
  expect(
    (await request.post(`${control}/session/expire?user=${owner.id}`)).ok(),
  ).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await login(page, user.email);
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(page.getByRole("article")).toBeVisible();
  expect(
    (await request.post(`${control}/session/expire?user=${owner.id}`)).ok(),
  ).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const other = await create(page);
  await login(page, other.email);
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(page.getByText("Статья не найдена.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(
    await page.evaluate(
      async (path) => (await fetch(`/api${path}/document`)).status,
      path,
    ),
  ).toBe(404);
  await page.getByRole("link", { name: "Моя библиотека" }).click();
  await expect(input(page)).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText("Статья не найдена.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("real list and reader recover after interrupted network without losing content or input", async ({
  page,
}) => {
  const user = await create(page);
  await page.goto("/login");
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  await page.route("**/api/links?*", (r) => r.abort());
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.unroute("**/api/links?*");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(input(page)).toBeVisible();
  await input(page).fill(`http://127.0.0.1:39876/slow/${crypto.randomUUID()}`);
  await save(page).click();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  await input(page).fill("https://example.com/keep");
  await page.route("**/api/links?*", (r) => r.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(input(page)).toHaveValue("https://example.com/keep");
  await page.unroute("**/api/links?*");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(input(page)).toHaveValue("https://example.com/keep");
  await page.route("**/document", (r) => r.abort());
  await page.getByRole("link", { name: "Читать статью" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.unroute("**/document");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("article")).toBeVisible();
  await page.route("**/document", (r) => r.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("article")).toBeVisible();
  await page.unroute("**/document");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("article")).toBeVisible();
});

test("return after login to an absent article shows a library exit", async ({
  page,
}) => {
  const user = await create(page);
  await page.context().clearCookies();
  const path = `/links/${crypto.randomUUID()}`;
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await login(page, user.email);
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(
    page.getByText("Статья не найдена.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("link", { name: "Моя библиотека" }).click();
  await expect(input(page)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("session expiring during a private image request hides the reader and returns after login", async ({
  page,
  request,
}) => {
  const user = await create(page);
  await page.goto("/login");
  await login(page, user.email);
  await expect(input(page)).toBeVisible();
  const owner = await session(page);
  await input(page).fill(
    `http://127.0.0.1:39876/images/normal/${crypto.randomUUID()}`,
  );
  await save(page).click();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/assets/**", async (r) => {
    started();
    await wait;
    await r.continue().catch(() => {});
  });
  await page.getByRole("link", { name: "Читать статью" }).click();
  await expect(page).toHaveURL(/\/links\/[a-f0-9-]+$/);
  const path = new URL(page.url()).pathname;
  await expect(page.getByRole("article")).toBeVisible();
  await seen;
  expect(
    (await request.post(`${control}/session/expire?user=${owner.id}`)).ok(),
  ).toBeTruthy();
  release();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.unroute("**/assets/**");
  await login(page, user.email);
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByRole("article").locator("img").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("article")
        .locator("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(
    await (await request.get(`${control}/owner/stats?user=${owner.id}`)).json(),
  ).toEqual({ links: 1, jobs: 1, generation: 1 });
});
