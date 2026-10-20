import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { creerEquipement, expect, test } from "./fixtures";

const suffixe = () => randomUUID().slice(0, 8);

async function creer<T>(api: APIRequestContext, route: string, data: object): Promise<T> {
  const res = await api.post(route, { data });
  expect(res.status(), `${route} : ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

/** Catégorie + champ « Puissance » (W) + connecteur PowerCon + modèle, tous uniques. */
async function preparerReferentiel(api: APIRequestContext) {
  const s = suffixe();
  const cat = await creer<{ id: number }>(api, "categories", { nom: `Cat ${s}` });
  const champ = await creer<{ id: number }>(api, "champs-specification", {
    nom: "Puissance",
    type: "nombre",
    unite: "W",
    categorie_id: cat.id,
  });
  const connecteur = await creer<{ id: number; nom: string }>(api, "connecteurs", {
    nom: `PowerCon ${s}`,
  });
  const modele = await creer<{ id: number; nom: string }>(api, "modeles", {
    nom: `Spec ${s}`,
  });
  const res = await api.patch(`modeles/${modele.id}`, { data: { categorie_id: cat.id } });
  expect(res.ok()).toBeTruthy();
  return { cat, champ, connecteur, modele };
}

test("référentiel : arbre de catégories, champs hérités et connecteur", async ({
  page,
  api,
}) => {
  const s = suffixe();
  const cat = `Lyres ${s}`;
  const connecteur = `PowerCon ${s}`;

  // Catégorie principale, créée depuis la liste.
  await page.goto("/referentiel");
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  await page.getByLabel("Nom", { exact: true }).fill(cat);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(/\/referentiel\/categories\/\d+$/);
  await expect(page.getByRole("heading", { name: cat })).toBeVisible();
  const racineId = Number(page.url().split("/").pop());

  // Un champ sur la racine, une sous-catégorie, puis une sous-sous-catégorie.
  await page.getByRole("button", { name: "Nouveau champ" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Puissance");
  await page.getByLabel("Type").selectOption("nombre");
  await page.getByPlaceholder("W, lm, Hz…").fill("W");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Champ créé.")).toBeVisible();

  await page.getByLabel("Nouvelle sous-catégorie").fill("Beam");
  await page.getByRole("button", { name: "Ajouter la sous-catégorie" }).click();
  await page.getByRole("link", { name: /^Beam/ }).click();
  await expect(page.getByRole("heading", { name: "Beam" })).toBeVisible();
  const fil = page.getByRole("navigation", { name: "Fil d'Ariane" });
  await expect(fil.getByRole("link", { name: cat })).toBeVisible();

  await page.getByLabel("Nouvelle sous-catégorie").fill("Mini");
  await page.getByRole("button", { name: "Ajouter la sous-catégorie" }).click();
  await page.getByRole("link", { name: /^Mini/ }).click();
  await expect(page.getByRole("heading", { name: "Mini" })).toBeVisible();
  const miniId = Number(page.url().split("/").pop());

  // Le petit-enfant hérite du champ de la racine, en lecture seule, lien vers elle.
  const herites = page.getByTestId("champs-herites");
  await expect(herites).toContainText("Hérité de");
  await expect(herites.getByRole("link", { name: cat })).toHaveAttribute(
    "href",
    `/referentiel/categories/${racineId}`,
  );
  await expect(herites).toContainText("Puissance");
  await expect(page.getByRole("button", { name: "Modifier Puissance" })).toHaveCount(0);

  // Un modèle rangé dans Mini : compté sur la fiche de la racine, et ses specs
  // proposent le champ hérité.
  const modele = await creer<{ id: number; nom: string }>(api, "modeles", {
    nom: `Beam ${s}`,
    categorie_id: miniId,
  });
  await page.goto(`/referentiel/categories/${racineId}`);
  await expect(page.getByText("Modèles (1)")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(modele.nom) })).toContainText(
    `${cat} › Beam › Mini`,
  );

  await page.goto(`/modeles/${modele.id}`);
  await page.getByRole("button", { name: "Éditer", exact: true }).click();
  await expect(page.getByLabel("Puissance (W)")).toBeVisible();

  // Liste : arbre dépliable, et recherche à plat avec le chemin des parentes.
  await page.goto("/referentiel");
  await page.getByRole("button", { name: `Déplier ${cat}` }).click();
  await expect(page.getByRole("link", { name: /^Beam/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Rechercher une catégorie" }).fill(cat);
  await expect(page.getByRole("link", { name: new RegExp(cat) })).toContainText(
    "1 sous-catégorie · 1 champ",
  );
  await page.getByRole("searchbox", { name: "Rechercher une catégorie" }).fill("Mini");
  await expect(page.getByRole("link", { name: /Mini/ }).first()).toContainText(`${cat} › Beam`);

  await page.getByRole("tab", { name: "Connecteurs" }).click();
  await page.getByRole("button", { name: "Nouveau connecteur" }).click();
  await page.getByLabel("Nouveau connecteur").fill(connecteur);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText(connecteur, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Connecteurs" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("searchbox", { name: "Rechercher un connecteur" }).fill(connecteur);
  await expect(page.getByText(connecteur, { exact: true })).toBeVisible();
});

test("spécifications d'un modèle et totaux de prestation", async ({ page, api }) => {
  const { connecteur, modele } = await preparerReferentiel(api);
  const u1 = await creerEquipement(api, "Spec", { modele_id: modele.id });
  const u2 = await creerEquipement(api, "Spec", { modele_id: modele.id });
  const presta = await creer<{ id: number }>(api, "prestations", {
    nom: `Presta ${suffixe()}`,
    type: "Interne",
  });

  await page.goto(`/modeles/${modele.id}`);
  await page.getByRole("button", { name: "Éditer", exact: true }).click();
  const fiche = page.locator("main");
  await fiche.getByLabel("Poids (kg)").fill("12,5");
  await fiche.getByLabel("Prix interne (€)").fill("30");
  await fiche.getByLabel("Puissance (W)").fill("300");
  await fiche.getByRole("button", { name: "Ajouter", exact: true }).click();
  // Ligne de connectique : tient dans la page sur téléphone, sélecteur de connecteur lisible.
  const carte = await fiche.boundingBox();
  for (const champ of ["Connecteur", "Sens", "Quantité", "Retirer"]) {
    const box = await fiche.getByLabel(champ, { exact: true }).boundingBox();
    expect(box!.x + box!.width, champ).toBeLessThanOrEqual(carte!.x + carte!.width);
  }
  const selecteur = await fiche.getByLabel("Connecteur", { exact: true }).boundingBox();
  expect(selecteur!.width).toBeGreaterThan(100);
  await fiche.getByLabel("Connecteur", { exact: true }).selectOption({ label: connecteur.nom });
  await fiche.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Spécifications enregistrées.")).toBeVisible();
  await expect(fiche).toContainText("12,5 kg");

  await page.goto(`/inventaire/${u1.id}`);
  await expect(page.getByText("12,5 kg")).toBeVisible();
  await expect(page.getByText("Héritées du modèle")).toBeVisible();

  for (const u of [u1, u2]) {
    await creer(api, `prestations/${presta.id}/allocations`, { equipment_id: u.id });
  }
  await page.goto(`/prestations/${presta.id}`);
  await expect(page.getByTestId("totaux-poids")).toHaveText("25 kg");
  await expect(page.getByTestId("totaux-prix")).toHaveText("60 €");
  await expect(page.getByTestId("totaux-entrees")).toContainText(`2× ${connecteur.nom}`);
});

test("totaux lisibles hors ligne", async ({ page, api, context }) => {
  const { connecteur, modele } = await preparerReferentiel(api);
  const put = await api.put(`modeles/${modele.id}/specs`, {
    data: {
      poids: 12.5,
      prix_interne: 30,
      connectiques: [{ connecteur_id: connecteur.id, sens: "entree", quantite: 1 }],
    },
  });
  expect(put.ok()).toBeTruthy();
  const u1 = await creerEquipement(api, "Spec", { modele_id: modele.id });
  const u2 = await creerEquipement(api, "Spec", { modele_id: modele.id });
  const presta = await creer<{ id: number }>(api, "prestations", {
    nom: `Presta ${suffixe()}`,
    type: "Interne",
  });
  for (const u of [u1, u2]) {
    await creer(api, `prestations/${presta.id}/allocations`, { equipment_id: u.id });
  }

  await page.goto(`/prestations/${presta.id}`);
  await expect(page.getByTestId("totaux-poids")).toHaveText("25 kg");

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(page.getByTestId("totaux-poids")).toHaveText("25 kg");

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByTestId("totaux-poids")).toHaveText("25 kg");
    await expect(page.getByTestId("totaux-prix")).toHaveText("60 €");
    await expect(page.getByTestId("totaux-entrees")).toContainText(`2× ${connecteur.nom}`);
  } finally {
    await context.setOffline(false);
  }
});

test.describe("staff", () => {
  test.use({ membre: `staff-${suffixe()}@e2e.example` });

  test("staff : unité sans modèle éditable", async ({ page, api }) => {
    const vol = await creerEquipement(api, "Flight", { est_contenant: true });
    await page.goto(`/inventaire/${vol.id}`);
    await page.getByRole("button", { name: "Éditer", exact: true }).click();
    await page.getByLabel("Poids (kg)").fill("8");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("8 kg")).toBeVisible();
  });
});
