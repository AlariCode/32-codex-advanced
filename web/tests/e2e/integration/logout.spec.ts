import { expect, test } from "@playwright/test";

test("logout via the local hostname revokes the session through the Next.js proxy", async ({
  page,
  context,
  request,
}) => {
  // The real API fixture configures PUBLIC_ORIGIN with 127.0.0.1.
  const origin = "http://localhost:3200";
  const email = `logout-${crypto.randomUUID()}@example.com`;
  await page.goto(`${origin}/register`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("LogoutIntegration42!");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("link", { name: `Профиль: ${email}` }).click();

  const cookie = (await context.cookies(origin)).find(
    ({ name }) => name === "linkbook_session",
  );
  expect(cookie).toBeDefined();
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  expect(
    (await context.cookies(origin)).some(
      ({ name }) => name === "linkbook_session",
    ),
  ).toBe(false);

  const response = await request.get(`${origin}/api/users/me`, {
    headers: { Cookie: `linkbook_session=${cookie!.value}` },
  });
  expect(response.status()).toBe(401);
});
