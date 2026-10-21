import { expect, test } from "@playwright/test";

test("registration link has a generous target and supports keyboard navigation", async ({
  page,
}) => {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ status: 401, json: { code: "unauthorized" } }),
  );
  await page.goto("/");
  const link = page.getByRole("link", { name: "Создать аккаунт" });
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

test("registration layout fits each viewport and the mobile submit stays above the fold", async ({
  page,
}) => {
  await page.goto("/register");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    viewport.width,
  );
  for (const control of [
    page.getByLabel("Email", { exact: true }),
    page.getByLabel("Пароль", { exact: true }),
    page.getByRole("button", { name: "Создать аккаунт" }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  }
  if (viewport.width <= 760) {
    const box = await page
      .getByRole("button", { name: "Создать аккаунт" })
      .boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }
});

test("small mobile and both sides of the breakpoint have no overflow", async ({
  page,
}) => {
  for (const width of [320, 760, 761]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/register");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    if (width <= 760) {
      const box = await page
        .getByRole("button", { name: "Создать аккаунт" })
        .boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(812);
    }
  }
});

test("obvious email typos are rejected locally and can be corrected", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/users/register", async (route) => {
    requests++;
    await route.fulfill({ status: 409, json: { code: "email_exists" } });
  });
  await page.goto("/register");
  const email = page.getByLabel("Email", { exact: true });
  await page.getByLabel("Пароль", { exact: true }).fill("example-password");
  for (const value of [
    "not-an-email",
    "reader@",
    "@example.com",
    "reader@@example.com",
    "reader @example.com",
  ]) {
    await email.fill(value);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Проверьте email. Например: reader@example.com.",
    );
    expect(requests).toBe(0);
  }
  await email.fill("reader@example.com");
  await expect(email).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Аккаунт с этим email уже существует",
  );
  expect(requests).toBe(1);
});

test("supported email forms reach the API and preserve the password", async ({
  page,
}) => {
  const addresses = [
    " Reader+tag@Example.COM ",
    "reader@localhost",
    '"reader name"@example.com',
    "читатель@example.com",
  ];
  const sent: { email: string; password: string }[] = [];
  await page.route("**/api/users/register", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { code: "email_exists" } });
  });
  await page.goto("/register");
  const password = "  пароль 😀  ";
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  for (const address of addresses) {
    await page.getByLabel("Email", { exact: true }).fill(address);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Аккаунт с этим email уже существует",
    );
  }
  expect(sent).toEqual(
    addresses.map((email) => ({ email: email.trim(), password })),
  );
});

test("successful submission shows loading then opens the authenticated library", async ({
  page,
}) => {
  let finishRequest!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  await page.route("**/api/users/register", async (route) => {
    await responseReady;
    await route.fulfill({
      status: 201,
      json: {
        id: "test-user",
        email: "reader@example.com",
        created_at: "2026-10-06T00:00:00Z",
      },
    });
  });
  await page.route("**/api/users/me", (route) =>
    route.fulfill({
      json: {
        id: "test-user",
        email: "reader@example.com",
        created_at: "2026-10-06T00:00:00Z",
      },
    }),
  );
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: "2026-10-06T00:00:00Z" },
    }),
  );
  await page.route("**/api/links/statuses?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: "2026-10-06T00:00:00Z" },
    }),
  );
  await page.goto("/register");
  await page.getByLabel("Email", { exact: true }).fill("reader@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("example-password");
  await page.getByRole("button", { name: "Показать пароль" }).click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("button", { name: "Создаём аккаунт…" }),
  ).toBeDisabled();
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
  finishRequest();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  await expect(
    page.getByText("reader@example.com", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveCount(0);
});
