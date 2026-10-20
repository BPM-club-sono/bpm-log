import { randomUUID } from "node:crypto";
import { creerEquipement, creerModele, expect, test } from "./fixtures";

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
  await expect(page.getByText(nomModele).first()).toBeVisible();
});

test("modèles : recherche, filtre par catégorie et fiche avec ses unités", async ({
  page,
  api,
}) => {
  const s = randomUUID().slice(0, 8);
  const cat = await api.post("categories", { data: { nom: `Lyres ${s}` } });
  expect(cat.status()).toBe(201);
  const { id: categorieId } = (await cat.json()) as { id: number };
  const autre = await creerModele(api, `Autre ${s}`);
  const modele = await creerModele(api, `MH-${s}`);
  const patch = await api.patch(`modeles/${modele.id}`, {
    data: { categorie_id: categorieId, marque: "Robe" },
  });
  expect(patch.ok()).toBeTruthy();
  const u1 = await creerEquipement(api, "Lyre", { modele_id: modele.id });
  const u2 = await creerEquipement(api, "Lyre", { modele_id: modele.id });

  await page.goto("/modeles");
  await page.getByRole("searchbox", { name: "Rechercher un modèle" }).fill(s);
  await expect(page.getByRole("link", { name: new RegExp(modele.nom) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(autre.nom) })).toBeVisible();
  await page.getByRole("button", { name: `Lyres ${s}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`categorie=${categorieId}`));
  await expect(page.getByRole("link", { name: new RegExp(autre.nom) })).toHaveCount(0);
  await page.getByRole("link", { name: new RegExp(modele.nom) }).click();

  await expect(page).toHaveURL(new RegExp(`/modeles/${modele.id}$`));
  await expect(page.getByRole("heading", { name: modele.nom })).toBeVisible();
  await expect(page.getByText("Unités (2)")).toBeVisible();
  await expect(page.getByText("2 fonctionnels")).toBeVisible();
  for (const u of [u1, u2]) {
    await expect(page.getByRole("link", { name: new RegExp(u.nom) })).toBeVisible();
  }

  // Édition des infos du modèle depuis sa fiche.
  await page.getByRole("button", { name: "Modifier" }).click();
  await page.getByPlaceholder("MH-100, H30V-L250…").fill(`${modele.nom} v2`);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${modele.nom} v2` })).toBeVisible();

  // « Ajouter des unités » ouvre la création avec ce modèle choisi.
  await page.getByRole("link", { name: "Ajouter des unités" }).click();
  await expect(page.getByPlaceholder("Lyre Beam 7R…")).toHaveValue(`${modele.nom} v2`);
  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page).toHaveURL(/\/inventaire\/\d+$/);
  await page.getByRole("link", { name: `${modele.nom} v2` }).first().click();
  await expect(page.getByText("Unités (3)")).toBeVisible();
});
