import { expect, test } from "../fixtures";

test("ADM-001: non-admin sees access restricted", async ({ page, loginAs }) => {
  await loginAs("seed-alice");
  await page.goto("/support");
  await expect(page.getByTestId("support-forbidden")).toBeVisible();
  await expect(page.getByTestId("count-pending")).toHaveCount(0);
});

test("ADM-002: admin sees pending count", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/support");
  // The base scenario has exactly one pending account (seed-carol).
  await expect(page.getByTestId("count-pending")).toContainText("1");
  await expect(page.getByTestId("user-row-seed-carol")).toBeVisible();
});

test("ADM-003: admin approves a pending user who then reaches the dashboard", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/support");
  await page.getByTestId("set-status-seed-carol-approved").click();

  // She leaves the pending list...
  await expect(page.getByTestId("user-row-seed-carol")).toHaveCount(0);
  await expect(page.getByTestId("count-pending")).toContainText("0");
  // ...and shows up as approved ("Validé").
  await page.getByTestId("tab-approved").click();
  await expect(page.getByTestId("user-row-seed-carol")).toContainText("Validé");

  // The scripts added later run later: from now on the page signs in as Carol.
  await loginAs("seed-carol");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
});

test("ACC-005: suspension takes effect on next load", async ({ page, api, loginAs }) => {
  await loginAs("seed-alice");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();

  // An administrator suspends her while she is signed in.
  const adminHeaders = { authorization: `Bearer ${await api.token("seed-admin")}` };
  const listing = await api.get("/api/admin/users?status=approved", { headers: adminHeaders });
  expect(listing.ok()).toBeTruthy();
  const { users } = (await listing.json()) as { users: { id: string; subject: string }[] };
  const alice = users.find((user) => user.subject === "seed-alice");
  expect(alice).toBeDefined();
  const suspension = await api.post(`/api/admin/users/${alice!.id}/status`, {
    headers: adminHeaders,
    data: { status: "suspended" },
  });
  expect(suspension.ok()).toBeTruthy();

  // Her next request is refused at once: the status is read from the database, not from the token.
  await page.reload();
  await expect(page.getByTestId("account-suspended")).toBeVisible();
  await expect(page.getByTestId("dashboard-empty")).toHaveCount(0);
});
