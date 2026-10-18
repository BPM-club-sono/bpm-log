import { creerEquipement, expect, test } from "./fixtures";

test("saisie manuelle d'un code-barres connu → fiche matériel", async ({ page, api }) => {
  const eq = await creerEquipement(api, "Ampli Crown XTi 6002");

  await page.goto("/scan");
  await page.getByPlaceholder("BPM-000001").fill(eq.barcode_uid);
  await page.getByRole("button", { name: "Chercher" }).click();

  await expect(page).toHaveURL(new RegExp(`/inventaire/${eq.id}$`));
  await expect(page.getByRole("heading", { name: eq.nom })).toBeVisible();
});

test("code inconnu → proposition de déclarer une panne", async ({ page }) => {
  await page.goto("/scan");
  await page.getByPlaceholder("BPM-000001").fill("BPM-999999");
  await page.getByRole("button", { name: "Chercher" }).click();

  await expect(page.getByText("inconnu dans le parc")).toBeVisible();
  await expect(page.getByRole("button", { name: "Déclarer une panne" })).toBeVisible();
});

test("hors ligne, le code est résolu depuis le miroir local", async ({ page, context, api }) => {
  const eq = await creerEquipement(api, "Pont alu 290 - 2m");

  // Le miroir se remplit à l'ouverture du scanner, tant qu'on est en ligne.
  await page.goto("/scan");
  await expect(page.getByText(/équipements disponibles hors ligne/)).toBeVisible();

  await context.setOffline(true);
  await page.getByPlaceholder("BPM-000001").fill(eq.barcode_uid);
  await page.getByRole("button", { name: "Chercher" }).click();

  await expect(page.getByText(eq.nom)).toBeVisible();
  await expect(page.getByText("Hors ligne — données du dernier passage en ligne.")).toBeVisible();
});
