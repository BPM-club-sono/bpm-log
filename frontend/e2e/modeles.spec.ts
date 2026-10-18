import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("création d'équipement : modèle obligatoire, créé sur place", async ({ page }) => {
  const suffixe = randomUUID().slice(0, 8);
  const nomModele = `MH-110 ${suffixe}`;

  await page.goto("/inventaire/nouveau");
  await page.getByPlaceholder("Lyre Beam 7R…").fill(`MH 7 ${suffixe}`);
  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page.getByText("Le modèle est obligatoire.")).toBeVisible();

  await page.getByRole("searchbox", { name: "Modèle" }).fill(nomModele);
  await page.getByRole("button", { name: `Créer le modèle « ${nomModele} »` }).click();
  await page.getByPlaceholder("Marque (optionnel)").fill("Robe");
  await page.getByRole("button", { name: "Créer le modèle", exact: true }).click();
  await expect(page.getByText("Changer", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page).toHaveURL(/\/inventaire\/\d+$/);
  await expect(page.getByText(nomModele)).toBeVisible();
});
