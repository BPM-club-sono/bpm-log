import { expect, test } from "./fixtures";

test.describe("visiteur non connecté", () => {
  test.use({ membre: null });

  test("est renvoyé vers la page de connexion", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Se connecter avec Google" })).toBeVisible();
  });
});

test("un admin connecté arrive sur le tableau de bord", async ({ page, api }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

  const me = await (await api.get("auth/me")).json();
  expect(me.role).toBe("Admin");
});

test.describe("compte inconnu", () => {
  test.use({ membre: "nouveau@e2e.example" });

  test("est provisionné en Staff à sa première requête", async ({ page, api }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

    const me = await (await api.get("auth/me")).json();
    expect(me.email).toBe("nouveau@e2e.example");
    expect(me.role).toBe("Staff");
  });
});

test("l'app recharge hors ligne grâce au service worker", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  // La page doit être contrôlée par le SW (précache prêt) avant de couper le réseau.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();

  // Profil mis en cache par AuthContext : pas de déconnexion hors ligne.
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(page.getByText("Hors ligne — modifications synchronisées plus tard")).toBeVisible();
});
