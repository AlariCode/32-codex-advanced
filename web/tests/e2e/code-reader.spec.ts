import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
});

const id = "12345678-1234-4234-8234-123456789abc";
const css = "* {\n  margin: 0;\n  padding: 0;\n}\n";
test("code keeps whitespace, highlights syntax, and scrolls independently of the page", async ({
  page,
}) => {
  const long = 'const message = "' + "long ".repeat(100) + '";';
  await page.route(`**/api/links/${id}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Примеры кода",
        submitted_url: "https://example.com/code",
        generation: 1,
        warnings: [],
        document: {
          schema_version: 1,
          blocks: [
            { kind: "paragraph", text: "Пример универсального селектора:" },
            { kind: "code", text: css, language: "css" },
            { kind: "code", text: long, language: "javascript" },
          ],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  const code = page.locator("pre").first();
  await expect(code.locator("code")).toHaveText(css);
  expect(await code.locator("code").textContent()).toBe(css);
  await expect(code.locator(".hljs-attribute").first()).toBeVisible();
  await code.focus();
  await expect(code).toBeFocused();
  const longCode = page.locator("pre").nth(1);
  expect(await longCode.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
  await page.reload();
  await expect(code.locator("code")).toHaveText(css);
});
test("unsupported language and large code stay readable; source markup never executes", async ({
  page,
}) => {
  const literal =
    '<img src=x onerror="window.codeAttack=true"><script>window.codeAttack=true</script>';
  const large = "const x = 1;\n".repeat(2000);
  await page.route(`**/api/links/${id}/document`, (route) =>
    route.fulfill({
      json: {
        title: "Безопасный код",
        submitted_url: "https://example.com/code",
        generation: 1,
        warnings: [],
        document: {
          schema_version: 1,
          blocks: [
            { kind: "code", language: "unknown-language", text: literal },
            { kind: "code", language: "javascript", text: large },
            { kind: "code", language: "html", text: literal },
          ],
        },
      },
    }),
  );
  await page.goto(`/links/${id}`);
  await expect(page.locator("pre code").first()).toHaveText(literal);
  await expect(
    page.locator("pre").first().locator("span,img,script"),
  ).toHaveCount(0);
  await expect(page.locator("pre code").nth(1)).toHaveText(large);
  await expect(page.locator("pre").nth(1).locator("span")).toHaveCount(0);
  await expect(page.locator("pre code").nth(2)).toHaveText(literal);
  await expect(page.locator("pre").nth(2).locator("img,script")).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, "codeAttack"))).toBe(
    false,
  );
});
