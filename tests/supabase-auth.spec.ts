import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

/**
 * Sign-in through Supabase Auth: password sign-in, the session cookies,
 * joining from an invitation with a new password, signing out. Runs with
 * LEDGERLINE_AUTH_E2E=supabase against tests/support/stand-in-auth.mjs (or
 * a real Supabase project); see the README's Going live section.
 */
const on = process.env.LEDGERLINE_AUTH_E2E === "supabase";
const PASSWORD = process.env.LEDGERLINE_DEMO_PASSWORD ?? "correct horse battery";

test.describe("Supabase sign-in", () => {
  test.skip(!on, "Runs with LEDGERLINE_AUTH_E2E=supabase");

  test.beforeAll(async () => {
    // A throwaway database: each run starts with no sign-ins, and Maria gets hers.
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("delete from auth.users");
    await db.end();
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.auth.admin.createUser({ email: "maria@saltlake.example", password: PASSWORD, email_confirm: true, user_metadata: { name: "Maria Antoniou" } });
    expect(error).toBeNull();
  });

  test("a partner signs in with a password, invites an accountant who makes her account from the link, and both sign out", async ({ page, browser, context }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fclients$/);
    await expect(page.getByRole("button", { name: /Sign in as/ })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("maria@saltlake.example");
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email address and password don’t match an account.").or(page.getByText("That email address and password don't match an account."))).toBeVisible();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("button", { name: /Maria Antoniou: account/ })).toBeVisible();
    expect((await context.cookies()).some(cookie => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"))).toBe(true);

    await page.goto("/settings/people");
    await page.getByLabel("Name").fill("Eleni Ioannou");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("eleni@saltlake.example");
    await page.getByRole("button", { name: "Invite" }).click();
    const link = (await page.locator("pre").first().innerText()).trim();

    const fresh = await browser.newContext();
    const joining = await fresh.newPage();
    await joining.goto(link);
    await joining.getByLabel("Choose a password").fill("short");
    await joining.getByRole("button", { name: "Make my account and join" }).click();
    await expect(joining.getByText("At least 10 characters.").first()).toBeVisible();
    await joining.getByLabel("Choose a password").fill("eleni's own long password");
    await joining.getByRole("button", { name: "Make my account and join" }).click();
    await expect(joining).toHaveURL(/\/\?joined=1$/);
    await expect(joining.getByRole("button", { name: /Eleni Ioannou: account/ })).toBeVisible();

    await joining.getByRole("button", { name: /Eleni Ioannou: account/ }).click();
    await joining.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(joining).toHaveURL(/\/sign-in$/);
    expect((await fresh.cookies()).some(cookie => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token") && cookie.value)).toBe(false);
    await joining.goto(link);
    await expect(joining.getByText("This invitation has been used.")).toBeVisible();
    await joining.goto("/sign-in");
    await joining.getByRole("textbox", { name: "Email", exact: true }).fill("eleni@saltlake.example");
    await joining.getByLabel("Password").fill("eleni's own long password");
    await joining.getByRole("button", { name: "Sign in" }).click();
    await expect(joining.getByRole("heading", { name: /clients/ })).toBeVisible();
    await fresh.close();
  });
});
