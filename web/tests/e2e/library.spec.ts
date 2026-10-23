import { expect, test, type Page } from "@playwright/test";

const identity = {
  id: "reader-1",
  email: "reader@example.com",
  created_at: "2026-10-14T00:00:00Z",
};
function card(
  id = "11111111-1111-4111-8111-111111111111",
  url = "https://example.com/article",
  created = "2026-10-14T00:00:00Z",
) {
  return {
    id,
    submitted_url: url,
    title: null,
    state: "processing",
    generation: 1,
    created_at: created,
    requested_at: created,
    deadline_at: "2026-10-14T00:02:00Z",
    can_read: false,
  };
}
async function authenticate(page: Page) {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ json: identity }),
  );
}
async function emptyLibrary(page: Page) {
  await authenticate(page);
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: identity.created_at },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
}

test("empty library fits viewport and supports keyboard saving", async ({
  page,
}) => {
  await emptyLibrary(page);
  await expect(
    page.getByText("Сохраните первую ссылку с помощью формы выше."),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
  const input = page.getByLabel("Ссылка на статью", { exact: true });
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Сохранить ссылку", exact: true }),
  ).toBeFocused();
  const box = await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("draft appears before delayed POST and becomes confirmed only after response", async ({
  page,
}) => {
  await emptyLibrary(page);
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const sent: unknown[] = [];
  await page.route("**/api/links", async (route) => {
    sent.push(route.request().postDataJSON());
    await ready;
    await route.fulfill({ status: 201, json: { link: card(), created: true } });
  });
  await page
    .getByLabel("Ссылка на статью", { exact: true })
    .fill("https://example.com/article");
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const draft = page.getByRole("article", {
    name: "Предварительная карточка",
    exact: true,
  });
  await expect(draft).toContainText("Ещё не сохранено");
  await expect(draft).toContainText("Сохраняем ссылку…");
  await expect(draft).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Обрабатываем", { exact: true })).toHaveCount(0);
  finish();
  await expect(draft).toHaveCount(0);
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  expect(sent).toEqual([{ url: "https://example.com/article" }]);
  await expect(page.locator(`#link-${card().id}`)).toBeFocused();
});

test("invalid URL remains a draft and can be corrected inline", async ({
  page,
}) => {
  await emptyLibrary(page);
  let posts = 0;
  await page.route("**/api/links", (route) => {
    posts++;
    return route.fulfill({
      status: 201,
      json: { link: card(), created: true },
    });
  });
  await page.getByLabel("Ссылка на статью", { exact: true }).fill("not-a-url");
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  const input = page.getByLabel("Исправить URL");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("article")).toContainText("Проверьте адрес");
  expect(posts).toBe(0);
  await input.fill("https://example.com/article");
  await page
    .getByRole("button", { name: "Сохранить исправленный адрес" })
    .click();
  await expect(
    page.getByText("Ссылка сохранена", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

for (const failure of [
  "server",
  "network",
  "invalid-response",
  "invalid-url",
] as const) {
  test(`send ${failure} error can be retried without losing URL`, async ({
    page,
  }) => {
    await emptyLibrary(page);
    let posts = 0;
    await page.route("**/api/links", async (route) => {
      posts++;
      if (posts === 1) {
        if (failure === "network") {
          await route.abort("failed");
          return;
        }
        if (failure === "invalid-response") {
          await route.fulfill({ status: 201, json: { created: true } });
          return;
        }
        await route.fulfill({
          status: failure === "invalid-url" ? 400 : 500,
          json: {
            code: failure === "invalid-url" ? "invalid_url" : "internal_error",
          },
        });
        return;
      }
      await route.fulfill({
        status: 201,
        json: { link: card(), created: true },
      });
    });
    await page
      .getByLabel("Ссылка на статью", { exact: true })
      .fill(card().submitted_url);
    await page
      .getByRole("button", { name: "Сохранить ссылку", exact: true })
      .click();
    const input = page.getByLabel("Исправить URL");
    await expect(input).toHaveValue(card().submitted_url);
    await expect(input).toBeFocused();
    await expect(page.getByRole("article").getByRole("alert")).toBeVisible();
    const description = await input.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${description}"]`)).toHaveAttribute(
      "role",
      "alert",
    );
    await page
      .getByRole("button", {
        name:
          failure === "invalid-url"
            ? "Сохранить исправленный адрес"
            : "Повторить отправку",
      })
      .click();
    await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
    expect(posts).toBe(2);
  });
}

test("reload reads server cards; duplicate focuses the existing card and metadata stays protected", async ({
  page,
}) => {
  await authenticate(page);
  const saved = card();
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: {
        links: [saved],
        next_cursor: "",
        server_time: identity.created_at,
      },
    }),
  );
  await page.route("**/api/links", (route) =>
    route.fulfill({ status: 200, json: { link: saved, created: false } }),
  );
  let gets = 0;
  await page.route(`**/api/links/${saved.id}`, (route) => {
    gets++;
    return route.fulfill({ json: saved });
  });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByLabel("Ссылка на статью", { exact: true })
    .fill("http://EXAMPLE.com/article?utm_source=test#section");
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  await expect(
    page.getByText("Ссылка уже сохранена", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.locator(`#link-${saved.id}`)).toBeFocused();
  await page
    .getByRole("button", { name: "Открыть карточку", exact: true })
    .click();
  await expect.poll(() => gets).toBe(1);
  await expect(page.locator(`#link-${saved.id}`)).toBeFocused();
});

for (const operation of ["save", "page", "metadata"] as const) {
  test(`401 during ${operation} removes all private content`, async ({
    page,
  }) => {
    await authenticate(page);
    await page.route("**/api/links?*", (route) => {
      if (route.request().url().includes("cursor="))
        return route.fulfill({ status: 401, json: { code: "unauthorized" } });
      return route.fulfill({
        json: {
          links: [card()],
          next_cursor: "next",
          server_time: identity.created_at,
        },
      });
    });
    await page.route("**/api/links", (route) =>
      route.fulfill({ status: 401, json: { code: "unauthorized" } }),
    );
    await page.route(`**/api/links/${card().id}`, (route) =>
      route.fulfill({ status: 401, json: { code: "unauthorized" } }),
    );
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(1);
    if (operation === "page")
      await page.getByRole("button", { name: "Показать ещё" }).click();
    else if (operation === "metadata")
      await page
        .getByRole("button", { name: "Открыть карточку", exact: true })
        .click();
    else {
      await page
        .getByLabel("Ссылка на статью", { exact: true })
        .fill("https://example.com/private-draft");
      await page
        .getByRole("button", { name: "Сохранить ссылку", exact: true })
        .click();
    }
    await expect(
      page.getByRole("heading", { name: "Моя библиотека" }),
    ).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(identity.email)).toHaveCount(0);
    await expect(
      page.getByText("https://example.com/private-draft", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Вход", exact: true }),
    ).toBeVisible();
  });
}

test("missing session and 401 list do not display private library", async ({
  page,
}) => {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Войдите, чтобы открыть личную библиотеку."),
  ).toBeVisible();
  await authenticate(page);
  await page.route("**/api/links?*", (route) =>
    route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.reload();
  await expect(
    page.getByText("Войдите, чтобы открыть личную библиотеку."),
  ).toBeVisible();
  await expect(page.getByText(identity.email)).toHaveCount(0);
});

test("pagination appends unique cards in order and wraps very long URLs", async ({
  page,
}) => {
  await authenticate(page);
  const first = card(
    "22222222-2222-4222-8222-222222222222",
    "https://example.com/" + "a".repeat(500),
    "2026-10-14T01:00:00Z",
  );
  const older = card();
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: route.request().url().includes("cursor=")
        ? { links: [first, older], next_cursor: "" }
        : { links: [first], next_cursor: "next" },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toContainText(
    first.submitted_url,
  );
  await expect(page.getByRole("button", { name: "Показать ещё" })).toHaveCount(
    0,
  );
  for (const width of [320, 375, 640, 641, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }
});

test("late POST cannot restore private cards after a 401", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/links?*", (route) =>
    route.fulfill({ json: { links: [card()], next_cursor: "next" } }),
  );
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/links", async (route) => {
    await wait;
    await route.fulfill({
      status: 201,
      json: {
        link: card("33333333-3333-4333-8333-333333333333"),
        created: true,
      },
    });
  });
  await page.route(`**/api/links/${card().id}`, (route) =>
    route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.goto("/");
  await page
    .getByLabel("Ссылка на статью", { exact: true })
    .fill("https://example.com/pending");
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  await expect(page.getByText("Сохраняем ссылку…")).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть карточку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  release();
  await expect(page.getByRole("article")).toHaveCount(0);
});
