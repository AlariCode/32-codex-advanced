import { expect, test } from "@playwright/test";

test("каталог дизайн-системы недоступен в production", async ({ page }) => {
  const response = await page.goto("/design");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Дизайн-система" }),
  ).toHaveCount(0);
});
