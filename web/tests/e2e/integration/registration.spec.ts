import { expect, test } from "@playwright/test";
test("registration authorizes immediately and opens library without a second login", async ({
  page,
}) => {
  const email = `auto-register-${crypto.randomUUID()}@example.com`;
  let logins = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/users/login")) logins++;
  });
  await page.goto("/register");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("AutomaticSession42!");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const me = await page.evaluate(async () => {
    const r = await fetch("/api/users/me");
    return { status: r.status, user: await r.json() };
  });
  expect(me.status).toBe(200);
  expect(me.user.email).toBe(email);
  expect(logins).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Моя библиотека" }),
  ).toBeVisible();
});
