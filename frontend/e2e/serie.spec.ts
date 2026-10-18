import { randomUUID } from "node:crypto";
import { creerModele, expect, test } from "./fixtures";

test("Parc : création de 3 exemplaires d'un modèle", async ({ page, api }) => {
  const modele = await creerModele(api, "MH-100");
  const base = `MH ${randomUUID().slice(0, 6)}`;
  await page.goto("/inventaire/nouveau");
  await page.getByRole("searchbox", { name: "Modèle" }).fill(modele.nom);
  await page.getByRole("button", { name: modele.nom, exact: true }).click();
  await expect(page.getByPlaceholder("Lyre Beam 7R…")).toHaveValue(modele.nom); // pré-rempli
  await page.getByPlaceholder("Lyre Beam 7R…").fill(base);
  await page.getByLabel("Nombre d'exemplaires").fill("3");
  await expect(page.getByText(`créera ${base} 1, ${base} 2, ${base} 3`)).toBeVisible();
  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page).toHaveURL(new RegExp(`/inventaire\\?modele=${modele.id}$`));
  await expect(page.getByText("3 équipements créés")).toBeVisible();
  for (const k of [1, 2, 3]) {
    await expect(page.getByText(`${base} ${k}`, { exact: true })).toBeVisible();
  }
});

test("Prestation : créer et allouer 2 locations", async ({ page, api }) => {
  const presta = await (
    await api.post("prestations", { data: { nom: `Presta ${randomUUID().slice(0, 8)}` } })
  ).json();
  const fournisseur = await (
    await api.post("fournisseurs", { data: { nom: `Loueur ${randomUUID().slice(0, 8)}` } })
  ).json();
  const base = `Lyre loc ${randomUUID().slice(0, 6)}`;

  await page.goto(`/prestations/${presta.id}`);
  await page.getByRole("button", { name: "Ajouter du matériel (créer une fiche)" }).click();
  await page.getByPlaceholder("Lyre Beam 7R…").fill(base);
  await page.getByLabel("Nombre d'exemplaires").fill("2");
  await page.locator("select").filter({ hasText: "— choisir —" }).selectOption({
    label: fournisseur.nom,
  });
  await page.getByRole("button", { name: "Créer et allouer" }).click();

  for (const k of [1, 2]) {
    const ligne = page.getByText(`${base} ${k}`, { exact: true });
    await expect(ligne).toBeVisible();
  }
  await expect(page.getByText("Location", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Planifié", { exact: true })).toHaveCount(2);

  const detail = await (await api.get(`prestations/${presta.id}`)).json();
  expect(detail.allocations).toHaveLength(2);
  for (const a of detail.allocations) expect(a.quantite).toBe(1);
});

test("Parc : série externe de 2 sans modèle", async ({ page, api }) => {
  const fournisseur = await (
    await api.post("fournisseurs", { data: { nom: `Loueur ${randomUUID().slice(0, 8)}` } })
  ).json();
  const base = `Pupitre loc ${randomUUID().slice(0, 6)}`;
  await page.goto("/inventaire/nouveau");
  await page.getByPlaceholder("Lyre Beam 7R…").fill(base);
  await page.getByLabel("Nombre d'exemplaires").fill("2");
  await page.getByLabel("Matériel en location externe").check();
  await page.locator("select").filter({ hasText: "— choisir —" }).selectOption({
    label: fournisseur.nom,
  });
  await page.getByRole("button", { name: "Créer l'équipement" }).click();
  await expect(page).toHaveURL(/\/inventaire$/);
  await expect(page.getByText("2 équipements créés")).toBeVisible();
  for (const k of [1, 2]) {
    await expect(page.getByText(`${base} ${k}`, { exact: true })).toBeVisible();
  }
});
