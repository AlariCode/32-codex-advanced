import { expect, test, type Page } from "@playwright/test";

// Chromium permits Secure cookies on loopback HTTP; APIRequestContext does not.
// Read the authenticated API through the same browser/proxy path as the UI.
async function authenticatedJSON(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
    return response.json();
  }, path);
}

for (const name of [
  "homepage",
  "pdf",
  "video",
  "login",
  "paywall",
  "js-only",
  "network",
]) {
  test(`${name} source correction retries the same card through API and worker`, async ({
    page,
    request,
  }) => {
    await request.post("http://127.0.0.1:39877/on");
    const email = `retry-${crypto.randomUUID()}@example.com`;
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
    await expect(
      page.getByRole("heading", { name: "Моя библиотека" }),
    ).toBeVisible();
    const url = `http://127.0.0.1:39876/article-case/${name}/${crypto.randomUUID()}`;
    await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
    await page
      .getByRole("button", { name: "Сохранить ссылку", exact: true })
      .click();
    const card = page.getByRole("article", {
      name: `Сохранённая ссылка ${url}`,
      exact: true,
    });
    await expect(
      card.getByText(
        name === "network" ? "Ошибка обработки" : "Текст статьи недоступен",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(card.getByRole("link", { name: "Читать статью" })).toHaveCount(
      0,
    );
    await expect(
      card.getByRole("link", { name: "Открыть оригинал" }),
    ).toHaveAttribute("href", url);
    await expect(
      card.getByRole("link", { name: "Открыть оригинал" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    const before = (await authenticatedJSON(page, "/api/links")).links.find(
      (item: { submitted_url: string }) => item.submitted_url === url,
    );
    // Keep three cards in both SQL and UI throughout the retry.
    // The original target is older than these two cards and must stay last.
    for (const suffix of ["first", "second"]) {
      await page
        .getByLabel("Ссылка на статью", { exact: true })
        .fill(`${url}-neighbor-${suffix}`);
      await page
        .getByRole("button", { name: "Сохранить ссылку", exact: true })
        .click();
      await expect(
        page.getByRole("article", {
          name: `Сохранённая ссылка ${url}-neighbor-${suffix}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    const orderBefore = (await authenticatedJSON(page, "/api/links")).links.map(
      (item: { id: string }) => item.id,
    );
    expect(orderBefore).toHaveLength(3);
    expect(orderBefore[2]).toBe(before.id);
    const savedCards = page.locator(
      'section[aria-label="Библиотека ссылок"] article[id^="link-"]',
    );
    await expect
      .poll(() =>
        savedCards.evaluateAll((nodes) =>
          nodes.map((node) => node.id.replace("link-", "")),
        ),
      )
      .toEqual(orderBefore);
    expect((await request.post(`${url}?correct`)).ok()).toBeTruthy();
    await card.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible(
      { timeout: 15000 },
    );
    const after = await authenticatedJSON(page, `/api/links/${before.id}`);
    expect(after.id).toBe(before.id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.generation).toBe(before.generation + 1);
    expect(Date.parse(after.deadline_at) - Date.parse(after.requested_at)).toBe(
      120000,
    );
    const orderAfter = (await authenticatedJSON(page, "/api/links")).links.map(
      (item: { id: string }) => item.id,
    );
    expect(orderAfter).toEqual(orderBefore);
    await expect
      .poll(() =>
        savedCards.evaluateAll((nodes) =>
          nodes.map((node) => node.id.replace("link-", "")),
        ),
      )
      .toEqual(orderBefore);
    await card.getByRole("link", { name: "Читать статью" }).click();
    await expect(
      page.getByRole("article", { name: "Сохранённая статья", exact: true }),
    ).toContainText("This final paragraph is a marker");
  });
}

test("lost real retry response can be confirmed before intentionally retrying its failed result", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:39877/on");
  const email = `retry-confirm-${crypto.randomUUID()}@example.com`;
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
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  const url = `http://127.0.0.1:39876/article-case/network/${crypto.randomUUID()}`;
  await page.getByLabel("Ссылка на статью", { exact: true }).fill(url);
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const card = page.getByRole("article", {
    name: `Сохранённая ссылка ${url}`,
    exact: true,
  });
  await expect(card.getByText("Ошибка обработки", { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  const before = (await authenticatedJSON(page, "/api/links")).links.find(
    (item: { submitted_url: string }) => item.submitted_url === url,
  );
  let lost = false;
  const generations: number[] = [];
  await page.route(`**/api/links/${before.id}/retry`, async (route) => {
    generations.push(route.request().postDataJSON().generation);
    if (lost) return route.continue();
    lost = true;
    const committed = await route.fetch();
    expect(committed.ok()).toBeTruthy();
    expect((await committed.json()).link.generation).toBe(2);
    await route.abort();
  });
  await card.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Не удалось подтвердить повторную обработку",
  );
  await expect
    .poll(
      async () => {
        const current = await authenticatedJSON(
          page,
          `/api/links/${before.id}`,
        );
        return { generation: current.generation, state: current.state };
      },
      { timeout: 15000 },
    )
    .toEqual({ generation: 2, state: "failed" });
  // The explicit get confirms generation 2 in the UI, rather than reloading it.
  const confirmed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/links/${before.id}`) &&
      response.request().method() === "GET",
  );
  await card
    .getByRole("button", { name: "Открыть карточку", exact: true })
    .click();
  expect((await (await confirmed).json()).generation).toBe(2);
  await expect(card.getByRole("alert")).toHaveCount(0);
  expect((await request.post(`${url}?correct`)).ok()).toBeTruthy();
  await card.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(card.getByRole("link", { name: "Читать статью" })).toBeVisible({
    timeout: 15000,
  });
  expect(generations).toEqual([1, 2]);
  const after = await authenticatedJSON(page, `/api/links/${before.id}`);
  expect(after.generation).toBe(3);
  expect(after.id).toBe(before.id);
  expect(after.created_at).toBe(before.created_at);
});
