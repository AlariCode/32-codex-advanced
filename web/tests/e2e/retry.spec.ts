import { expect, test } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const card = (generation = 1, state = "unavailable") => ({
  id,
  submitted_url: "https://example.com/article",
  title: "Article",
  state,
  generation,
  reason: "article_unavailable",
  can_read: state === "ready",
  created_at: "2026-10-15T00:00:00Z",
  requested_at: "2026-10-15T00:00:00Z",
  deadline_at: "2026-10-15T00:02:00Z",
});
const pageOf = (links: ReturnType<typeof card>[]) => ({
  links,
  next_cursor: "",
  server_time: "2026-10-15T00:00:00Z",
});
test("lost retry response retains error and replays original generation", async ({
  page,
}) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card()]) }),
  );
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: pageOf([]) }),
  );
  let calls = 0;
  await page.route(`**/api/links/${id}/retry`, (r) => {
    expect(r.request().postDataJSON()).toEqual({ generation: 1 });
    calls++;
    if (calls === 1) return r.abort();
    return r.fulfill({
      json: { link: card(2, "ready"), server_time: "2026-10-15T00:00:00Z" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось подтвердить повторную обработку",
  );
  await expect(page.getByText("Обрабатываем", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible();
  expect(calls).toBe(2);
});

test("late polling and card HTTP responses cannot replace retry or stop its polling", async ({
  page,
}) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card()]) }),
  );
  let resolvePoll: () => void = () => {};
  const pollStarted = new Promise<void>((resolve) => {
    resolvePoll = resolve;
  });
  let releasePoll: () => void = () => {};
  const oldPoll = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });
  let polled = false;
  await page.route("**/api/links/statuses?*", async (r) => {
    if (!new URL(r.request().url()).searchParams.has("ids"))
      return r.fulfill({ json: pageOf([card(1, "processing")]) });
    if (!polled) {
      polled = true;
      resolvePoll();
      await oldPoll;
      return r.fulfill({ json: pageOf([card(1, "ready")]) });
    }
    return r.fulfill({
      json: pageOf([{ ...card(2, "ready"), title: "New generation" }]),
    });
  });
  let releaseGet: () => void = () => {};
  const oldGet = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  let resolveGet: () => void = () => {};
  const getStarted = new Promise<void>((resolve) => {
    resolveGet = resolve;
  });
  await page.route(`**/api/links/${id}`, async (r) => {
    resolveGet();
    await oldGet;
    return r.fulfill({ json: card(1, "ready") });
  });
  await page.route(`**/api/links/${id}/retry`, (r) =>
    r.fulfill({
      json: {
        link: card(2, "processing"),
        server_time: "2026-10-15T00:00:00Z",
      },
    }),
  );
  await page.goto("/");
  await pollStarted;
  await page
    .getByRole("button", { name: "Открыть карточку", exact: true })
    .click();
  await getStarted;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  releasePoll();
  releaseGet();
  await expect(
    page.getByRole("heading", { name: "New generation" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible();
});

test("retry restarts the waiting clock and only the server declares timeout", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2001-01-01") });
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card(1, "failed")]) }),
  );
  let retried = false;
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({ json: pageOf(retried ? [card(2, "processing")] : []) }),
  );
  await page.route(`**/api/links/${id}/retry`, (r) => {
    retried = true;
    return r.fulfill({
      json: {
        link: card(2, "processing"),
        server_time: "2026-10-15T00:00:00Z",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  // Poll responses deliberately carry an old clock: delayed HTTP must not rewind age.
  await page.clock.runFor(31000);
  await expect(
    page.getByText("Обработка занимает больше времени", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(90000);
  await expect(page.getByText("Ошибка обработки", { exact: true })).toHaveCount(
    0,
  );
});

for (const state of ["failed", "unavailable"]) {
  test(`confirming ${state} after a lost response allows an intentional new retry`, async ({
    page,
  }) => {
    await page.route("**/api/users/me", (r) =>
      r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
    );
    await page.route("**/api/links?*", (r) =>
      r.fulfill({ json: pageOf([card()]) }),
    );
    await page.route("**/api/links/statuses?*", (r) =>
      r.fulfill({ json: pageOf([]) }),
    );
    const generations: number[] = [];
    await page.route(`**/api/links/${id}/retry`, (r) => {
      generations.push(r.request().postDataJSON().generation);
      if (generations.length === 1) return r.abort();
      return r.fulfill({
        json: { link: card(3, "ready"), server_time: "2026-10-15T00:00:00Z" },
      });
    });
    await page.route(`**/api/links/${id}`, (r) =>
      r.fulfill({
        json: { ...card(2, state), title: "Confirmed second attempt" },
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Не удалось подтвердить повторную обработку",
    );
    await page
      .getByRole("button", { name: "Открыть карточку", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Confirmed second attempt" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Читать статью" }),
    ).toBeVisible();
    expect(generations).toEqual([1, 2]);
  });
}

test("opening an unconfirmed processing retry resumes automatic polling", async ({
  page,
}) => {
  await page.route("**/api/users/me", (r) =>
    r.fulfill({ json: { id: "owner", email: "owner@example.com" } }),
  );
  await page.route("**/api/links?*", (r) =>
    r.fulfill({ json: pageOf([card()]) }),
  );
  await page.route("**/api/links/statuses?*", (r) =>
    r.fulfill({
      json: pageOf(
        new URL(r.request().url()).searchParams.has("ids")
          ? [card(2, "ready")]
          : [],
      ),
    }),
  );
  await page.route(`**/api/links/${id}/retry`, (r) => r.abort());
  await page.route(`**/api/links/${id}`, (r) =>
    r.fulfill({ json: card(2, "processing") }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть карточку", exact: true })
    .click();
  await expect(page.getByText("Обрабатываем", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Читать статью" })).toBeVisible();
});
