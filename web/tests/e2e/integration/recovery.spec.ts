import { expect, test, type Page } from "@playwright/test";
const fixture = "http://127.0.0.1:39876";
const control = "http://127.0.0.1:39877";
async function login(page: Page, existingEmail?: string) {
  const email = existingEmail ?? `recovery-${crypto.randomUUID()}@example.com`;
  if (!existingEmail)
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
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  return email;
}
async function save(page: Page, url: string) {
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/links"),
  );
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const data = await (await response).json();
  return {
    card: page.getByRole("article", {
      name: `Сохранённая ссылка ${url}`,
      exact: true,
    }),
    link: data.link,
  };
}
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${control}/worker/on`)).ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  await request.post(`${control}/worker/on`);
});

test("real 30/120 second deadline includes slow fetch and survives reload", async ({
  page,
}, info) => {
  test.setTimeout(155_000);
  await login(page);
  const { card, link } = await save(
    page,
    `${fixture}/delay/${crypto.randomUUID()}?ms=130000`,
  );
  await expect(card.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible({ timeout: 40_000 });
  await expect(card).not.toContainText("Ошибка обработки");
  await page.reload();
  await expect(
    card.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("long-wait.png"),
    fullPage: true,
  });
  await expect(card).toContainText(
    "Не удалось обработать ссылку за две минуты.",
    { timeout: 100_000 },
  );
  const current = await page.evaluate(
    async (id) => await (await fetch(`/api/links/${id}`)).json(),
    link.id,
  );
  expect(Date.now()).toBeGreaterThanOrEqual(
    Date.parse(link.deadline_at) - 1000,
  );
  expect(current.state).toBe("failed");
  expect(current.reason).toBe("timeout");
  expect(current.deadline_at).toBe(link.deadline_at);
  expect(current.generation).toBe(link.generation);
  await page.screenshot({
    path: info.outputPath("timeout.png"),
    fullPage: true,
  });
});

test("queued job expires while worker is stopped; late worker cannot publish", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await login(page);
  expect((await request.post(`${control}/worker/off`)).ok()).toBeTruthy();
  const { card, link } = await save(
    page,
    `${fixture}/article/${crypto.randomUUID()}`,
  );
  await expect(card).toContainText(
    "Не удалось обработать ссылку за две минуты.",
    { timeout: 130_000 },
  );
  expect((await request.post(`${control}/worker/on`)).ok()).toBeTruthy();
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(card).toContainText("Ошибка обработки");
  const response = await page.evaluate(async (id) => {
    const r = await fetch(`/api/links/${id}/document`);
    return { status: r.status, body: await r.json() };
  }, link.id);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe("article_not_ready");
});

test("Retry-After crosses 30s; closing page and expired session do not cancel committed work", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(65_000);
  const email = await login(page);
  const owner = await page.evaluate(
    async () => (await (await fetch("/api/users/me")).json()).id,
  );
  const url = `${fixture}/retry-once/${crypto.randomUUID()}`;
  const { card, link } = await save(page, url);
  await expect(
    card.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible({ timeout: 40_000 });
  expect(
    (await request.post(`${control}/session/expire?user=${owner}`)).ok(),
  ).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.close();
  await new Promise((resolve) => setTimeout(resolve, 6500));
  const returned = await context.newPage();
  await login(returned, email);
  const saved = returned.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
  await expect(saved.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 10_000,
  });
  const current = await returned.evaluate(
    async (id) => await (await fetch(`/api/links/${id}`)).json(),
    link.id,
  );
  expect(current.deadline_at).toBe(link.deadline_at);
  expect(current.generation).toBe(1);
  const stats = await (await request.get(`${control}/stats`)).json();
  expect(stats.retryHits[new URL(url).pathname]).toBe(2);
  await returned.close();
});

test("killed worker is reclaimed after its original lease and page returns ready", async ({
  page,
  request,
}, info) => {
  test.setTimeout(75_000);
  await login(page);
  const before = (await (await request.get(`${control}/stats`)).json())
    .fixtureHits;
  const url = `${fixture}/delay/${crypto.randomUUID()}?ms=4000`;
  const { card, link } = await save(page, url);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${control}/stats`)).json()).fixtureHits,
    )
    .toBeGreaterThan(before);
  expect((await request.post(`${control}/worker/off`)).ok()).toBeTruthy();
  await expect(card.getByText("Обрабатываем", { exact: true })).toBeVisible();
  expect((await request.post(`${control}/worker/on`)).ok()).toBeTruthy();
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 60_000,
  });
  await page.reload();
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible();
  const current = await page.evaluate(
    async (id) => await (await fetch(`/api/links/${id}`)).json(),
    link.id,
  );
  expect(current.deadline_at).toBe(link.deadline_at);
  expect(current.generation).toBe(1);
  await page.screenshot({
    path: info.outputPath("recovered.png"),
    fullPage: true,
  });
});
