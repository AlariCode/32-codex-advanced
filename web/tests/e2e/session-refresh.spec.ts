import { expect, test, type Page } from "@playwright/test";

const identity = {
  id: "owner",
  email: "owner@example.com",
  created_at: "2026-10-21T00:00:00Z",
};
const id = "11111111-1111-4111-8111-111111111111";
const card = {
  id,
  submitted_url: "https://example.com/saved",
  title: "Saved article",
  state: "ready",
  generation: 1,
  created_at: identity.created_at,
  requested_at: identity.created_at,
  deadline_at: identity.created_at,
  can_read: true,
};
const pageOf = {
  links: [card],
  next_cursor: "",
  server_time: identity.created_at,
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function library(page: Page) {
  await page.route("**/api/users/me", (r) => r.fulfill({ json: identity }));
  await page.route("**/api/links?*", (r) => r.fulfill({ json: pageOf }));
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: { ...pageOf, links: [] } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
}
async function restore(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("initial session check never offers guest navigation before its result", async ({
  page,
}) => {
  const wait = gate();
  await page.route("**/api/users/me", async (r) => {
    await wait.promise;
    await r.fulfill({ json: identity });
  });
  await page.route("**/api/links?*", (r) => r.fulfill({ json: pageOf }));
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: { ...pageOf, links: [] } }),
  );
  await page.goto("/");
  await expect(page.getByText("Проверяем вход…")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Войти|Создать аккаунт/ }),
  ).toHaveCount(0);
  wait.release();
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
});

test("focus rechecks session without remounting cards, resetting input or cancelling a save", async ({
  page,
}) => {
  await library(page);
  const save = gate();
  const session = gate();
  const started = gate();
  let checks = 0;
  await page.route("**/api/users/me", async (r) => {
    checks++;
    started.release();
    await session.promise;
    await r.fulfill({ json: identity });
  });
  await page.route("**/api/links", async (r) => {
    await save.promise;
    await r.fulfill({
      status: 201,
      json: {
        created: true,
        link: {
          ...card,
          id: "22222222-2222-4222-8222-222222222222",
          submitted_url: "https://example.com/new",
        },
        server_time: identity.created_at,
      },
    });
  });
  const input = page.getByLabel("Ссылка на статью", { exact: true });
  await input.fill("https://example.com/new");
  await page
    .getByRole("button", { name: "Сохранить ссылку", exact: true })
    .click();
  await expect(page.getByText("Сохраняем ссылку…")).toBeVisible();
  await input.fill("https://example.com/next");
  await input.focus();
  const node = await page.locator(`#link-${id}`).elementHandle();
  await restore(page);
  await started.promise;
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  await expect(input).toHaveValue("https://example.com/next");
  await expect(input).toBeFocused();
  await expect(page.getByText("Сохраняем ссылку…")).toBeVisible();
  expect(await node!.evaluate((el) => el.isConnected)).toBe(true);
  expect(checks).toBe(1);
  session.release();
  save.release();
  await expect(
    page.getByText("Ссылка сохранена", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(await node!.evaluate((el) => el.isConnected)).toBe(true);
});

test("expired session on focus still clears private content", async ({
  page,
}) => {
  await library(page);
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await restore(page);
  await expect(
    page.getByText("Войдите, чтобы открыть личную библиотеку."),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(identity.email)).toHaveCount(0);
});

test("account change on focus replaces the previous owner's library", async ({
  page,
}) => {
  await library(page);
  await page.route("**/api/users/me", (r) =>
    r.fulfill({
      json: { ...identity, id: "other", email: "other@example.com" },
    }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: { ...pageOf, links: [] } }),
  );
  await restore(page);
  await expect(page.getByText("other@example.com")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(identity.email)).toHaveCount(0);
});

for (const result of ["success", "network", "unauthorized"] as const) {
  test(`reader focus preserves the article until revalidation: ${result}`, async ({
    page,
  }) => {
    const article = {
      title: "Saved article",
      submitted_url: card.submitted_url,
      generation: 1,
      warnings: [],
      document: {
        schema_version: 1,
        blocks: [
          {
            kind: "paragraph",
            text: "The complete archived article remains readable.",
          },
        ],
      },
    };
    await page.route(`**/api/links/${id}/document`, (r) =>
      r.fulfill({ json: article }),
    );
    await page.goto(`/links/${id}`);
    const content = page.getByRole("article", {
      name: "Сохранённая статья",
      exact: true,
    });
    await expect(content).toBeVisible();
    const node = await content.elementHandle();
    const wait = gate();
    const started = gate();
    await page.route(`**/api/links/${id}/document`, async (r) => {
      started.release();
      await wait.promise;
      if (result === "network") await r.abort("failed");
      else if (result === "unauthorized")
        await r.fulfill({ status: 401, json: { code: "unauthorized" } });
      else await r.fulfill({ json: article });
    });
    await restore(page);
    await started.promise;
    await expect(content).toBeVisible();
    expect(await node!.evaluate((el) => el.isConnected)).toBe(true);
    wait.release();
    if (result === "unauthorized") {
      await expect(
        page.getByText("Войдите, чтобы прочитать сохранённую статью."),
      ).toBeVisible();
      await expect(content).toHaveCount(0);
    } else if (result === "network") {
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      await expect(content).toBeVisible();
    } else {
      await expect(content).toContainText(
        "The complete archived article remains readable.",
      );
      expect(await node!.evaluate((el) => el.isConnected)).toBe(true);
    }
  });
}
