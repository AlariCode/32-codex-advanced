import { expect, test } from "@playwright/test";

test("каталог показывает токены и позволяет проверить общие компоненты", async ({
  page,
}) => {
  const response = await page.goto("/design");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Дизайн-система" }),
  ).toBeVisible();

  const navigation = page.getByRole("navigation", {
    name: "Разделы дизайн-системы",
  });
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Цвета" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#colors$/);
  await expect(
    page.getByText("--color-action-primary", { exact: true }),
  ).toBeVisible();

  await navigation.getByRole("link", { name: "Типографика" }).click();
  await expect(page).toHaveURL(/#typography$/);
  await expect(
    page.getByText("--text-title-feature", { exact: true }),
  ).toBeVisible();
  const fonts = await page.evaluate(async () => {
    const sample = "Linkbook Кириллица";
    const regular = await document.fonts.load(
      '400 16px "Inter Variable"',
      sample,
    );
    const italic = await document.fonts.load(
      'italic 400 16px "Inter Variable"',
      sample,
    );
    return { regular: regular.length, italic: italic.length };
  });
  expect(fonts.regular).toBeGreaterThanOrEqual(2);
  expect(fonts.italic).toBeGreaterThanOrEqual(2);

  await navigation.getByRole("link", { name: "Компоненты" }).click();
  await expect(page).toHaveURL(/#components$/);
  await expect(page.getByRole("button", { name: "Недоступна" })).toBeDisabled();
  await expect(page.getByLabel("Адрес статьи")).toHaveAccessibleDescription(
    "Введите полный URL статьи.",
  );

  const password = page.getByLabel("Пароль", { exact: true });
  await password.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Показать пароль" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Скрыть пароль" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");

  const form = page.getByRole("form", { name: "Пример формы аккаунта" });
  await form.getByRole("button", { name: "Проверить форму" }).click();
  await expect(form.getByLabel("Email")).toBeFocused();
  await expect(form.getByRole("status")).toHaveCount(0);
  await form.getByLabel("Email").fill("reader@example.com");
  await form.getByRole("button", { name: "Проверить форму" }).click();
  await expect(form.getByRole("status")).toHaveText("Форма заполнена.");
  await expect(page).toHaveURL(/#components$/);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
});

test("поля каталога помещаются при увеличении текста до 200%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design#components");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const toggle = page.getByRole("button", { name: "Показать пароль" });
  await toggle.click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
