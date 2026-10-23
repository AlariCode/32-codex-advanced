import { expect, test, type Page } from "@playwright/test";
const identity = {
  id: "owner",
  email: "owner@example.com",
  created_at: "2026-10-21T00:00:00Z",
};
const id = "11111111-1111-4111-8111-111111111111";
const card = {
  id,
  submitted_url: "https://example.com/article",
  title: "Saved",
  state: "ready",
  generation: 1,
  created_at: "2026-10-21T00:00:00Z",
  requested_at: "2026-10-21T00:00:00Z",
  deadline_at: "2026-10-21T00:00:00Z",
};
const list = { links: [card], next_cursor: "", server_time: card.created_at };
const article = {
  title: "Saved",
  submitted_url: card.submitted_url,
  generation: 1,
  warnings: [],
  document: {
    schema_version: 1,
    blocks: [{ kind: "paragraph", text: "Private archived content" }],
  },
};
async function mock(page: Page) {
  await page.route("**/api/users/me", (r) => r.fulfill({ json: identity }));
  await page.route("**/api/links?*", (r) => r.fulfill({ json: list }));
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: { ...list, links: [] } }),
  );
  await page.route(`**/api/links/${id}/document`, (r) =>
    r.fulfill({ json: article }),
  );
}
const input = (page: Page) =>
  page.getByLabel("Ссылка на статью", { exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "Сохранить ссылку", exact: true });
const draft = (page: Page) =>
  page.getByRole("article", { name: "Предварительная карточка", exact: true });

test("unsent address and edited draft survive a closed page only for verified owner", async ({
  page,
  context,
}) => {
  await mock(page);
  await page.goto("/");
  await input(page).fill("invalid");
  await save(page).click();
  await draft(page)
    .getByLabel("Исправить URL")
    .fill("https://example.com/edited");
  await input(page).fill("https://example.com/unsent");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("linkbook:drafts:v1:owner")),
    )
    .toContain("unsent");
  await page.reload();
  await expect(input(page)).toHaveValue("https://example.com/unsent");
  await expect(draft(page).getByLabel("Исправить URL")).toHaveValue(
    "https://example.com/edited",
  );
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "other", email: "other@example.com" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByText("other@example.com")).toBeVisible();
  await expect(input(page)).toHaveValue("");
  await expect(draft(page)).toHaveCount(0);
  await page.reload();
  await expect(draft(page)).toHaveCount(0);
  await page.close();
  const newPage = await context.newPage();
  await mock(newPage);
  await newPage.goto("/");
  await expect(input(newPage)).toHaveValue("https://example.com/unsent");
  await expect(draft(newPage).getByLabel("Исправить URL")).toHaveValue(
    "https://example.com/edited",
  );
});

test("lost response restored as unknown and corrected duplicate leaves other drafts intact", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/api/links", (r) => r.abort());
  await page.goto("/");
  await input(page).fill("another invalid");
  await save(page).click();
  await input(page).fill(card.submitted_url);
  await save(page).click();
  await expect(page.getByText(/Исход отправки неизвестен/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Исход отправки неизвестен/)).toBeVisible();
  await page.route("**/api/links", (r) =>
    r.fulfill({
      json: { link: card, created: false, server_time: card.created_at },
    }),
  );
  await page
    .getByRole("button", { name: "Повторить отправку", exact: true })
    .click();
  await expect(
    page.getByText("Ссылка уже сохранена", { exact: true }),
  ).toBeVisible();
  await expect(draft(page)).toHaveCount(1);
  await expect(draft(page)).toContainText("another invalid");
  await expect(page.locator(`#link-${id}`)).toBeFocused();
  await page.reload();
  await expect(draft(page)).toHaveCount(1);
});

test("storage denied still allows saving with explicit recovery warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("denied");
      },
    });
  });
  await mock(page);
  await page.route("**/api/links", (r) =>
    r.fulfill({
      json: { link: card, created: true, server_time: card.created_at },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText(/Восстановление черновиков недоступно/),
  ).toBeVisible();
  await input(page).fill(card.submitted_url);
  await save(page).click();
  await expect(
    page.getByText("Ссылка сохранена", { exact: true }),
  ).toBeVisible();
});

test("list initial and background errors retry without discarding input or pagination", async ({
  page,
}) => {
  await mock(page);
  let failing = true;
  await page.route("**/api/links?*", (r) =>
    failing ? r.abort() : r.fulfill({ json: list }),
  );
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось загрузить",
  );
  failing = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await input(page).fill("keep this");
  failing = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось обновить",
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(input(page)).toHaveValue("keep this");
  failing = false;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(input(page)).toHaveValue("keep this");
});

test("reader retries initial and background outage and clears content on owner change", async ({
  page,
}) => {
  await mock(page);
  let failing = true;
  await page.route(`**/api/links/${id}/document`, (r) =>
    failing
      ? r.fulfill({ status: 503, json: { code: "service_unavailable" } })
      : r.fulfill({ json: article }),
  );
  await page.goto(`/links/${id}`);
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("article")).toContainText(
    "Private archived content",
  );
  failing = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("article")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "other", email: "other@example.com" } }),
  );
  await page.route(`**/api/links/${id}/document`, (r) =>
    r.fulfill({ status: 404, json: { code: "not_found" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByText("Статья не найдена.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Моя библиотека" }),
  ).toBeVisible();
});

for (const destination of [
  "https://evil.example/",
  "//evil.example/",
  "/\\evil.example",
  "/links/%2f%2fevil",
  "/links/" + id,
]) {
  test(`login validates returnTo ${destination}`, async ({ page }) => {
    await mock(page);
    await page.route("**/api/users/login", (r) =>
      r.fulfill({ json: identity }),
    );
    await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
    await page.getByLabel("Пароль", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(
      destination === `/links/${id}` ? new RegExp(`/links/${id}$`) : /\/$/,
    );
    await expect(
      page.getByRole("heading", {
        name: destination === `/links/${id}` ? "Saved" : "Моя библиотека",
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("interrupted sending restores unknown without automatic POST and corrected duplicate preserves another draft", async ({
  page,
}) => {
  await mock(page);
  let posts = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/links", async (r) => {
    posts++;
    await wait;
    await r
      .fulfill({
        json: { link: card, created: false, server_time: card.created_at },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await input(page).fill("invalid other");
  await save(page).click();
  await input(page).fill("https://example.com/pending");
  await save(page).click();
  await expect(page.getByText("Сохраняем ссылку…")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("linkbook:drafts:v1:owner")),
    )
    .toContain('"sending"');
  await page.reload();
  await expect(page.getByText(/Исход отправки неизвестен/)).toBeVisible();
  expect(posts).toBe(1);
  release();
  await page.unroute("**/api/links");
  const pending = draft(page).filter({ hasText: "Исход отправки неизвестен" });
  await pending
    .getByLabel("Исправить URL")
    .fill("http://example.com/article#fragment");
  await page.route("**/api/links", (r) =>
    r.fulfill({
      json: { link: card, created: false, server_time: card.created_at },
    }),
  );
  await pending.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(
    page.getByText("Ссылка уже сохранена", { exact: true }),
  ).toBeVisible();
  await expect(draft(page)).toHaveCount(1);
  await expect(draft(page)).toContainText("invalid other");
  await expect(page.locator(`#link-${id}`)).toBeFocused();
});

test("late previous-owner save cannot overwrite current owner's draft", async ({
  page,
}) => {
  await mock(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/links", async (r) => {
    await wait;
    await r
      .fulfill({
        json: { link: card, created: true, server_time: card.created_at },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await input(page).fill("https://example.com/old");
  await save(page).click();
  await expect(page.getByText("Сохраняем ссылку…")).toBeVisible();
  await page.route("**/api/users/me", (r) =>
    r.fulfill({
      json: { ...identity, id: "new-owner", email: "new@example.com" },
    }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: { ...list, links: [] } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("new@example.com")).toBeVisible();
  await input(page).fill("new private draft");
  release();
  await expect(input(page)).toHaveValue("new private draft");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.reload();
  await expect(input(page)).toHaveValue("new private draft");
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("background failure preserves all loaded pages and retrying pagination requests the failed cursor", async ({
  page,
}) => {
  await mock(page);
  let fail = false;
  const older = {
    ...card,
    id: "22222222-2222-4222-8222-222222222222",
    submitted_url: "https://example.com/older",
    created_at: "2026-10-20T00:00:00Z",
  };
  await page.route("**/api/links?*", (r) =>
    fail
      ? r.abort()
      : r.fulfill({
          json: r.request().url().includes("cursor=")
            ? { ...list, links: [older] }
            : { ...list, next_cursor: "older" },
        }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Показать ещё" }),
  ).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: /^Не удалось/ }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await input(page).fill("not sent");
  await save(page).click();
  await input(page).fill("keep input");
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: /^Не удалось/ }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(input(page)).toHaveValue("keep input");
  fail = false;
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: /^Не удалось/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(draft(page)).toContainText("not sent");
  await expect(page.getByRole("button", { name: "Показать ещё" })).toHaveCount(
    0,
  );
});

for (const view of ["library", "reader"] as const) {
  for (const account of ["same", "other"] as const) {
    test(`history snapshot hides ${view} until ${account} account is verified`, async ({
      page,
    }) => {
      await mock(page);
      await page.goto(view === "library" ? "/" : `/links/${id}`);
      await expect(page.getByRole("article")).toBeVisible();
      if (view === "library") await input(page).fill("private unsent");
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/users/me", async (r) => {
        await wait;
        await r.fulfill({
          json:
            account === "same"
              ? identity
              : { ...identity, id: "other", email: "other@example.com" },
        });
      });
      if (account === "other") {
        await page.route("**/api/links?*", (r) =>
          r.fulfill({ json: { ...list, links: [] } }),
        );
        await page.route(`**/api/links/${id}/document`, (r) =>
          r.fulfill({ status: 404, json: { code: "not_found" } }),
        );
      }
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        );
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });
      await expect(
        page.getByText("Проверяем вход…", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("article")).toHaveCount(0);
      await expect(input(page)).toHaveCount(0);
      release();
      if (account === "same") {
        await expect(page.getByRole("article")).toBeVisible();
        if (view === "library")
          await expect(input(page)).toHaveValue("private unsent");
      } else {
        await expect(page.getByRole("article")).toHaveCount(0);
        if (view === "library") {
          await expect(page.getByText("other@example.com")).toBeVisible();
          await expect(input(page)).toHaveValue("");
        } else await expect(page.getByText("Статья не найдена.")).toBeVisible();
      }
    });
  }
}

test("late document from the previous article cannot replace the next article", async ({
  page,
}) => {
  await mock(page);
  const second = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/links?*", (r) =>
    r.fulfill({
      json: {
        ...list,
        links: [
          card,
          {
            ...card,
            id: second,
            title: "Second",
            submitted_url: "https://example.com/second",
          },
        ],
      },
    }),
  );
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`**/api/links/${id}/document`, async (r) => {
    started();
    await wait;
    await r.fulfill({ json: article }).catch(() => {});
  });
  await page.route(`**/api/links/${second}/document`, (r) =>
    r.fulfill({
      json: {
        ...article,
        title: "Second article",
        document: {
          schema_version: 1,
          blocks: [{ kind: "paragraph", text: "The current document" }],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  await seen;
  await page.getByRole("link", { name: "Моя библиотека" }).click();
  await page
    .locator(`#link-${second}`)
    .getByRole("link", { name: "Читать статью" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Second article", exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("article")).toContainText("The current document");
  await expect(
    page.getByText("Private archived content", { exact: true }),
  ).toHaveCount(0);
});

test("failure discovering processing links is visible and can be retried", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/api/links/statuses?*", (r) => r.abort());
  await page.goto("/");
  await expect(
    page.getByText(
      "Не удалось проверить обрабатываемые ссылки. Повторите загрузку.",
      { exact: true },
    ),
  ).toBeVisible();
  await input(page).fill("preserved unsent");
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: { ...list, links: [] } }),
  );
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    page.getByText(
      "Не удалось проверить обрабатываемые ссылки. Повторите загрузку.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(input(page)).toHaveValue("preserved unsent");
  await expect(page.getByRole("article")).toHaveCount(1);
});
