import { expect, test } from "@playwright/test";

test("real profile token authorizes MCP as owner, is shown once and is revoked", async ({
  page,
  request,
}) => {
  const email = `mcp-${crypto.randomUUID()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("MCPIntegration42!");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page.getByRole("link", { name: `Профиль: ${email}` }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("button", { name: "Создать MCP-токен" }).click();
  const input = page.getByLabel("Новый MCP-токен");
  await expect(input).toBeVisible();
  const token = await input.inputValue();
  expect(token).toMatch(/^lb_mcp_[A-Za-z0-9_-]{43}$/);
  const mcp = (method: string, params: object = {}, secret = token) =>
    request.post("http://127.0.0.1:18080/mcp", {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
  const noToken = await request.post("http://127.0.0.1:18080/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(noToken.status()).toBe(401);
  expect((await mcp("tools/list", {}, "invalid")).status()).toBe(401);
  const url = `https://example.com/mcp-${crypto.randomUUID()}`;
  const saved = await mcp("tools/call", {
    name: "save_link",
    arguments: { url },
  });
  expect(saved.status()).toBe(200);
  const result = await saved.json();
  expect(result.result.isError).not.toBe(true);
  const id = result.result.structuredContent.id;
  const list = await page.evaluate(async () =>
    (await fetch("/api/links")).json(),
  );
  expect(list.links.some((item: { id: string }) => item.id === id)).toBe(true);
  const metadata = await page.evaluate(async () =>
    (await fetch("/api/users/me/mcp-tokens")).json(),
  );
  expect(metadata).toHaveLength(1);
  expect(Object.keys(metadata[0]).sort()).toEqual(["created_at", "id"]);
  expect(JSON.stringify(metadata)).not.toContain(token);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Отозвать токен" }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await page.screenshot({
    path: `../tmp/playwright/mcp-profile-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
  await page.getByRole("button", { name: "Отозвать токен" }).click();
  await page.getByRole("button", { name: "Подтвердить отзыв" }).click();
  await expect(page.getByRole("status")).toContainText("Токен отозван");
  expect((await mcp("tools/list")).status()).toBe(401);
  await page.getByRole("link", { name: "В библиотеку" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: url }),
  ).toBeVisible();
});
