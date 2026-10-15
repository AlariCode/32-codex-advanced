import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "test-user",
  email: "reader@example.com",
  created_at: "2026-10-07T00:00:00Z",
};
const credentialsError =
  "Неверный email или пароль. Проверьте данные и попробуйте ещё раз.";

test.beforeEach(async ({ page }) => {
  let authenticated = false;
  page.on("response", (response) => {
    if (
      (response.url().endsWith("/api/users/login") &&
        response.status() === 200) ||
      (response.url().endsWith("/api/users/register") &&
        response.status() === 201)
    )
      authenticated = true;
  });
  await page.route("**/api/users/me", (route) =>
    route.fulfill(
      authenticated
        ? { json: user }
        : { status: 401, json: { code: "unauthorized" } },
    ),
  );
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: user.created_at },
    }),
  );
  await page.route("**/api/links/statuses?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: user.created_at },
    }),
  );
});

async function fillLogin(
  page: Page,
  email = user.email,
  password = "password123",
) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
}

test("login is reachable from home and registration, with keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Уже есть аккаунт? Войти" });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle("Вход — Linkbook");
  await page
    .getByRole("link", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("link", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("newly registered users go directly to their library", async ({
  page,
}) => {
  await page.route("**/api/users/register", (route) =>
    route.fulfill({ status: 201, json: user }),
  );
  await page.goto("/register");
  await fillLogin(page);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
});

test("login layout fits the viewport and controls have comfortable touch targets", async ({
  page,
}) => {
  await page.goto("/login");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    viewport.width,
  );
  for (const control of [
    page.getByLabel("Email", { exact: true }),
    page.getByLabel("Пароль", { exact: true }),
    page.getByRole("button", { name: "Войти", exact: true }),
    page.getByRole("button", { name: "Показать пароль" }),
    page.getByRole("link", { name: "Создать аккаунт", exact: true }),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  if (viewport.width <= 760) {
    const box = (await page
      .getByRole("button", { name: "Войти", exact: true })
      .boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
});

test("small screens, breakpoint widths and landscape have no horizontal overflow", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 812],
    [760, 812],
    [761, 812],
    [812, 375],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/login");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page
      .getByRole("button", { name: "Войти", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeInViewport();
  }
});

test("empty fields and email typos are rejected locally and errors can be corrected", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/users/login", (route) => {
    requests++;
    return route.fulfill({
      status: 401,
      json: { code: "invalid_credentials" },
    });
  });
  await page.goto("/login");
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Пароль", { exact: true });
  const submit = page.getByRole("button", { name: "Войти", exact: true });
  await submit.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#login-email-description")).toHaveText(
    "Введите email.",
  );
  await expect(page.locator("#login-password-description")).toHaveText(
    "Введите пароль.",
  );
  await email.fill(user.email);
  await submit.click();
  await expect(password).toBeFocused();
  await password.fill("x");
  for (const address of [
    "not-an-email",
    "reader@",
    "@example.com",
    "reader@@example.com",
    "reader @example.com",
  ]) {
    await email.fill(address);
    await submit.click();
    await expect(email).toBeFocused();
    await expect(page.locator("#login-email-description")).toContainText(
      "Проверьте email",
    );
  }
  expect(requests).toBe(0);
  await email.fill(user.email);
  await expect(email).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#login-email-description")).toHaveCount(0);
  await submit.click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    credentialsError,
  );
  expect(requests).toBe(1); // A short nonempty password is allowed to reach login API.
});

test("password manager attributes and visibility toggle preserve credentials", async ({
  page,
}) => {
  await page.goto("/login");
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Пароль", { exact: true });
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await password.fill("  Пароль 😀  ");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Показать пароль" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Скрыть пароль" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Скрыть пароль" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("  Пароль 😀  ");
});

test("supported emails, whitespace and Unicode passwords reach API unchanged", async ({
  page,
}) => {
  const sent: { email: string; password: string }[] = [];
  await page.route("**/api/users/login", (route) => {
    sent.push(route.request().postDataJSON());
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toBe("application/json");
    return route.fulfill({
      status: 401,
      json: { code: "invalid_credentials" },
    });
  });
  await page.goto("/login");
  const values = [
    { email: " Reader+tag@Example.COM ", password: "  Пароль 😀  " },
    { email: "reader@localhost", password: "        " },
    { email: '"reader name"@example.com', password: "x" },
    { email: "читатель@example.com", password: "😀😀😀😀😀😀😀😀" },
  ];
  for (const value of values) {
    await fillLogin(page, value.email, value.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      credentialsError,
    );
  }
  expect(sent).toEqual(
    values.map((value) => ({ ...value, email: value.email.trim() })),
  );
});

test("Enter submits once, loading locks inputs, success redirects to library and clears password", async ({
  page,
}) => {
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let requests = 0;
  await page.route("**/api/users/login", async (route) => {
    requests++;
    await ready;
    await route.fulfill({ status: 200, json: user });
  });
  await page.goto("/login");
  await fillLogin(page);
  await page.getByLabel("Пароль", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Входим…" })).toBeDisabled();
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Показать пароль" }),
  ).toBeDisabled();
  await page.getByLabel("Пароль", { exact: true }).press("Enter");
  finish();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
  await page.goto("/login");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
});

test("invalid credentials retain inputs, focus the error and allow a successful retry", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/users/login", (route) => {
    requests++;
    return route.fulfill(
      requests === 1
        ? { status: 401, json: { code: "invalid_credentials" } }
        : { status: 200, json: user },
    );
  });
  await page.goto("/login");
  await fillLogin(page, user.email, "wrong");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    credentialsError,
  );
  await expect(page.locator("form").getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    user.email,
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("wrong");
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  expect(requests).toBe(2);
});

for (const scenario of [
  {
    status: 400,
    code: "invalid_email",
    message: "Проверьте email",
    field: "Email",
  },
  {
    status: 400,
    code: "invalid_password",
    message: "Введите пароль.",
    field: "Пароль",
  },
  {
    status: 413,
    code: "request_too_large",
    message: "Данные формы слишком большие.",
  },
  {
    status: 400,
    code: "invalid_request",
    message: "Не удалось отправить форму.",
  },
  {
    status: 415,
    code: "unsupported_media_type",
    message: "Не удалось отправить форму.",
  },
  { status: 500, code: "internal_error", message: "Не удалось войти." },
  { status: 503, code: "unknown_error", message: "Не удалось войти." },
]) {
  test(`API error ${scenario.status}/${scenario.code} is actionable and unlocks submission`, async ({
    page,
  }) => {
    await page.route("**/api/users/login", (route) =>
      route.fulfill({ status: scenario.status, json: { code: scenario.code } }),
    );
    await page.goto("/login");
    await fillLogin(page);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      scenario.message,
    );
    if (scenario.field)
      await expect(
        page.getByLabel(scenario.field, { exact: true }),
      ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
  });
}

test("network errors allow retry without losing entered credentials", async ({
  page,
}) => {
  await page.route("**/api/users/login", (route) => route.abort("failed"));
  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Не удалось связаться с сервером.",
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue(
    "password123",
  );
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/users/login");
  await page.route("**/api/users/login", (route) =>
    route.fulfill({ status: 200, json: user }),
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
});

for (const response of [
  { status: 200, json: {} },
  { status: 200, json: { ...user, created_at: "invalid" } },
  { status: 201, json: user },
  { status: 200, body: "broken JSON", contentType: "application/json" },
  { status: 502, body: "upstream unavailable", contentType: "text/plain" },
]) {
  test(`unexpected response ${response.status}/${JSON.stringify(response)} never displays success`, async ({
    page,
  }) => {
    await page.route("**/api/users/login", (route) => route.fulfill(response));
    await page.goto("/login");
    await fillLogin(page);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Не удалось войти.",
    );
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
  });
}
