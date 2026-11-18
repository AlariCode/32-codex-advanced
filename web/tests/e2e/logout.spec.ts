import { expect, test } from "@playwright/test";

const identity = { id: "owner", email: "reader@example.com" };

test("выход из профиля очищает данные вкладок и открывает страницу входа", async ({
  page,
  context,
}) => {
  let loggedIn = true;
  await context.route("**/api/users/me", (route) =>
    loggedIn
      ? route.fulfill({ json: identity })
      : route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await context.route("**/api/users/me/mcp-tokens", (route) =>
    route.fulfill({ json: [] }),
  );
  await context.route("**/api/users/logout", (route) => {
    expect(route.request().method()).toBe("POST");
    loggedIn = false;
    return route.fulfill({ status: 204 });
  });
  const otherTab = await context.newPage();
  await otherTab.goto("/profile");
  await expect(otherTab.getByText(identity.email)).toBeVisible();
  await page.goto("/profile");

  const logout = page.getByRole("button", { name: "Выйти из аккаунта" });
  await expect(logout).toBeVisible();
  const target = await logout.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );

  await logout.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Пароль", { exact: true })).toBeVisible();
  await expect(otherTab).toHaveURL(/\/login\?returnTo=%2Fprofile$/);
  await expect(otherTab.getByText(identity.email)).toHaveCount(0);
});

test("при ошибке выхода можно повторить запрос", async ({ page }) => {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ json: identity }),
  );
  await page.route("**/api/users/me/mcp-tokens", (route) =>
    route.fulfill({ json: [] }),
  );
  let requests = 0;
  let finishFirst!: () => void;
  const response = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  await page.route("**/api/users/logout", async (route) => {
    if (++requests === 1) {
      await response;
      return route.fulfill({ status: 500, json: { code: "internal_error" } });
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto("/profile");
  const logout = page.getByRole("button", { name: "Выйти из аккаунта" });
  await logout.click();
  await expect(logout).toBeDisabled();
  await expect(logout).toHaveAttribute("aria-busy", "true");
  await expect(logout).toHaveText("Выходим…");
  finishFirst();
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("Не удалось выйти из аккаунта.");
  const alertBox = (await alert.boundingBox())!;
  const panelBox = (await page
    .getByRole("region", { name: "MCP-токены" })
    .boundingBox())!;
  expect(panelBox.y).toBeGreaterThan(alertBox.y + alertBox.height);
  await expect(logout).toBeFocused();
  await expect(page.getByText(identity.email)).toBeVisible();
  await logout.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  expect(requests).toBe(2);
});
