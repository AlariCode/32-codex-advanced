import { expect, test, type Page } from "@playwright/test";

const path = "**/api/users/me/mcp-tokens";
const identity = {
  id: "owner",
  email: "reader@example.com",
  created_at: "2026-11-13T10:00:00Z",
};
const token = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: identity.created_at,
  token: "lb_mcp_" + "a".repeat(43),
};
async function me(page: Page) {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ json: identity }),
  );
}

test("profile creates a one-time secret, copies, confirms and revokes", async ({
  page,
  context,
}) => {
  await me(page);
  let exists = false;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route(path, (route) => {
    if (route.request().method() === "POST") {
      exists = true;
      return route.fulfill({ status: 201, json: token });
    }
    return route.fulfill({
      json: exists ? [{ id: token.id, created_at: token.created_at }] : [],
    });
  });
  await page.route(`${path}/${token.id}`, (route) => {
    exists = false;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/profile");
  await expect(page.getByText("Активных токенов пока нет.")).toBeVisible();
  await page.getByRole("button", { name: "Создать MCP-токен" }).click();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveValue(token.token);
  await expect(page.getByLabel("Новый MCP-токен")).toBeFocused();
  await page.getByRole("button", { name: "Скопировать", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    token.token,
  );
  await expect(page.getByRole("status")).toContainText("скопирован");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(token.token);
  await page.getByRole("button", { name: "Я сохранил токен" }).click();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Токен 11111111", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveCount(0);
  await page.getByRole("button", { name: "Отозвать токен" }).click();
  await expect(
    page.getByRole("button", { name: "Подтвердить отзыв" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Отозвать токен" }),
  ).toBeFocused();
  expect(exists).toBe(true);
  await page.getByRole("button", { name: "Отозвать токен" }).click();
  await page.getByRole("button", { name: "Подтвердить отзыв" }).click();
  await expect(page.getByText("Активных токенов пока нет.")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Токен отозван");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
});

test("errors preserve the token and allow retry; 401 clears private data", async ({
  page,
}) => {
  await me(page);
  let createFails = true;
  let deleteFails = true;
  await page.route(path, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    if (createFails) {
      createFails = false;
      return route.fulfill({ status: 500 });
    }
    return route.fulfill({ status: 201, json: token });
  });
  await page.route(`${path}/${token.id}`, (route) => {
    if (deleteFails) {
      deleteFails = false;
      return route.fulfill({ status: 500 });
    }
    return route.fulfill({ status: 401 });
  });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Создать MCP-токен" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Создать MCP-токен" }).click();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveValue(token.token);
  await page.getByRole("button", { name: "Отозвать токен" }).click();
  await page.getByRole("button", { name: "Подтвердить отзыв" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveValue(token.token);
  await page.getByRole("button", { name: "Подтвердить отзыв" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile/);
  await expect(page.getByText(identity.email)).toHaveCount(0);
  await expect(page.getByLabel("Новый MCP-токен")).toHaveCount(0);
});

test("profile retries loading and clears one-time secret on account change", async ({
  page,
}) => {
  await me(page);
  let failed = false;
  await page.route(path, (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 201, json: token });
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 500 });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/profile");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.getByRole("button", { name: "Создать MCP-токен" }).click();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveValue(token.token);
  await page.route("**/api/users/me", (route) =>
    route.fulfill({
      json: { ...identity, id: "other", email: "other@example.com" },
    }),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("linkbook:session-reset")),
  );
  await expect(
    page.getByText("other@example.com", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Новый MCP-токен")).toHaveCount(0);
  await expect(page.getByText("Токен 11111111", { exact: true })).toHaveCount(
    0,
  );
});
