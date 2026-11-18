import { expect, test } from "@playwright/test";

test("рабочие страницы используют общую типографику и помещаются в экран", async ({
  page,
}) => {
  const articleID = "12345678-1234-4234-8234-123456789abc";
  let guest = true;
  await page.route("**/api/users/me", (route) =>
    guest
      ? route.fulfill({ status: 401, json: { code: "unauthorized" } })
      : route.fulfill({ json: { id: "reader", email: "reader@example.com" } }),
  );
  await page.route("**/api/users/me/mcp-tokens", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/links?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: "2026-11-18T00:00:00Z" },
    }),
  );
  await page.route("**/api/links/statuses?*", (route) =>
    route.fulfill({
      json: { links: [], next_cursor: "", server_time: "2026-11-18T00:00:00Z" },
    }),
  );
  await page.route(`**/api/links/${articleID}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Цифровые библиотеки",
        submitted_url: "https://example.com/article",
        warnings: ["images_omitted", "html_truncated"],
        generation: 1,
        document: {
          schema_version: 2,
          blocks: [
            {
              kind: "paragraph",
              children: [{ kind: "text", text: "Текст статьи" }],
            },
          ],
        },
      },
    }),
  );

  for (const [url, title] of [
    ["/", "Хорошие ссылки. В одном месте."],
    ["/login", "Вход"],
    ["/register", "Регистрация"],
    ["/", "Моя библиотека"],
    ["/profile", "Профиль"],
    [`/links/${articleID}`, "Цифровые библиотеки"],
  ]) {
    guest = title === "Хорошие ссылки. В одном месте.";
    await page.goto(url);
    const heading = page.getByRole("heading", { level: 1, name: title });
    await expect(heading).toBeVisible();
    if (title === "Моя библиотека") {
      await expect(
        page.getByRole("button", { name: "Сохранить ссылку" }),
      ).toHaveText("Сохранить ссылку");
    }
    await expect(heading).toHaveCSS("font-weight", "400");
    expect(
      await heading.evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain("Inter Variable");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(page.viewportSize()!.width);
  }

  const warning = page.getByRole("article").getByRole("note");
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText("Пропущенные изображения");
  await expect(warning).toContainText("HTML страницы превысил предел");
  await expect(
    page.getByRole("link", { name: "В библиотеку" }),
  ).toHaveAttribute("href", "/");
});
