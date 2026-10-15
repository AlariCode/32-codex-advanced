import { expect, test } from "@playwright/test";

test("server age survives reload and browser clock skew; offline never invents timeout", async ({
  page,
}) => {
  const serverEpoch = Date.parse("2030-01-01T00:00:00Z");
  let age = 29_000;
  let offline = false;
  let state = "processing";
  const card = () => ({
    id: "12345678-1234-4234-8234-123456789abc",
    submitted_url: "https://example.com/waiting",
    title: null,
    state,
    generation: 1,
    reason: state === "failed" ? "timeout" : null,
    created_at: new Date(serverEpoch).toISOString(),
    requested_at: new Date(serverEpoch).toISOString(),
    deadline_at: new Date(serverEpoch + 120_000).toISOString(),
  });
  await page.clock.install({ time: new Date("2001-01-01T00:00:00Z") });
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: {
        links: [card()],
        next_cursor: "",
        server_time: new Date(serverEpoch + age).toISOString(),
      },
    }),
  );
  await page.route("**/api/links/statuses?*", (route) =>
    offline
      ? route.abort()
      : route.fulfill({
          json: {
            links: [card()],
            next_cursor: "",
            server_time: new Date(serverEpoch + age).toISOString(),
          },
        }),
  );
  await page.goto("/");
  const saved = page.getByRole("article", {
    name: "Сохранённая ссылка https://example.com/waiting",
    exact: true,
  });
  await expect(saved.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await page.getByLabel("Ссылка на статью", { exact: true }).focus();
  age = 31_000;
  await page.clock.runFor(2100);
  await expect(
    saved.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible();
  await expect(saved).not.toContainText("Ошибка обработки");
  await expect(
    page.getByLabel("Ссылка на статью", { exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(
    saved.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible();
  await page.clock.setSystemTime(new Date("2099-01-01T00:00:00Z"));
  offline = true;
  await page.clock.runFor(125_000);
  await expect(
    saved.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Не удалось обновить статусы" }),
  ).toContainText("Не удалось обновить статусы");
  await expect(saved).not.toContainText("Ошибка обработки");
  state = "failed";
  age = 160_000;
  offline = false;
  await page.clock.runFor(2100);
  await expect(saved).toContainText(
    "Не удалось обработать ссылку за две минуты.",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Не удалось обновить статусы" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
});
