import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { creerEquipement, creerModele, expect, test } from "./fixtures";

async function creerPresta(
  api: APIRequestContext,
  extra: Record<string, unknown> = {},
): Promise<{ id: number; nom: string }> {
  const res = await api.post("prestations", {
    data: { nom: `Presta ${randomUUID().slice(0, 8)}`, ...extra },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: number; nom: string };
}

async function nbAllocations(api: APIRequestContext, prestaId: number): Promise<number> {
  const res = await api.get(`prestations/${prestaId}`);
  return ((await res.json()) as { allocations: unknown[] }).allocations.length;
}

test("ajout par modèle : stepper −/+, unités HS exclues", async ({ page, api }) => {
  const modele = await creerModele(api, "MH-100");
  await creerEquipement(api, "MH", { modele_id: modele.id });
  await creerEquipement(api, "MH", { modele_id: modele.id });
  const hs = await creerEquipement(api, "MH HS", {
    modele_id: modele.id,
    statut_actuel: "En_Panne",
  });
  const presta = await creerPresta(api);

  await page.goto(`/prestations/${presta.id}`);
  // Mode par modèle par défaut.
  await page.getByPlaceholder("Modèle… (MH-100)").fill(modele.nom);
  const ligne = page.getByTestId(`modele-${modele.nom}`);
  await expect(ligne).toContainText("2/3 dispo");

  const plus = ligne.getByRole("button", { name: `Ajouter un ${modele.nom}` });
  await plus.click();
  await expect(ligne).toContainText("1/3 dispo");
  await plus.click();
  await expect(ligne).toContainText("0/3 dispo");
  // L'unité HS n'est jamais proposée.
  await expect(plus).toBeDisabled();
  await expect.poll(() => nbAllocations(api, presta.id)).toBe(2);

  await ligne.getByRole("button", { name: `Retirer un ${modele.nom}` }).click();
  await expect(ligne).toContainText("1/3 dispo");
  await expect.poll(() => nbAllocations(api, presta.id)).toBe(1);

  // Recherche par nom : l'unité HS est listée mais grisée.
  await page.getByRole("button", { name: "Passer à la recherche par nom" }).click();
  await page.getByPlaceholder("Nom ou code-barres…").fill(hs.nom);
  const resultat = page.getByRole("button", { name: new RegExp(hs.nom) });
  await expect(resultat).toContainText("HS");
  await expect(resultat).toBeDisabled();

  // Le mode choisi est mémorisé.
  await page.reload();
  await expect(page.getByPlaceholder("Nom ou code-barres…")).toBeVisible();
});

test("unité déjà prise sur une prestation aux dates qui chevauchent", async ({ page, api }) => {
  const modele = await creerModele(api, "H30V-L250");
  const eq = await creerEquipement(api, "H30V", { modele_id: modele.id });
  const a = await creerPresta(api, { date_debut: "2031-03-01", date_fin: "2031-03-03" });
  const res = await api.post(`prestations/${a.id}/allocations`, {
    data: { equipment_id: eq.id },
  });
  expect(res.status()).toBe(201);
  const b = await creerPresta(api, { date_debut: "2031-03-02" });

  await page.goto(`/prestations/${b.id}`);
  await page.getByPlaceholder("Modèle… (MH-100)").fill(modele.nom);
  const ligne = page.getByTestId(`modele-${modele.nom}`);
  await expect(ligne).toContainText("0/1 dispo");

  await page.getByRole("button", { name: "Passer à la recherche par nom" }).click();
  await page.getByPlaceholder("Nom ou code-barres…").fill(eq.nom);
  const resultat = page.getByRole("button", { name: new RegExp(eq.nom) });
  await expect(resultat).toContainText(`Pris · ${a.nom}`);
  await expect(resultat).toBeDisabled();
});

test("unité tombée en panne après allocation : signalée sur la prestation", async ({
  page,
  api,
}) => {
  const eq = await creerEquipement(api, "Lyre");
  const presta = await creerPresta(api);
  await api.post(`prestations/${presta.id}/allocations`, { data: { equipment_id: eq.id } });
  await api.patch(`equipments/${eq.id}`, { data: { statut_actuel: "En_Panne" } });

  await page.goto(`/prestations/${presta.id}`);
  await expect(page.getByText("1 unité HS dans la prestation")).toBeVisible();
});

test("ajout par modèle désactivé hors ligne", async ({ page, context, api }) => {
  const presta = await creerPresta(api);
  await page.goto(`/prestations/${presta.id}`);
  const champ = page.getByPlaceholder("Modèle… (MH-100)");
  await expect(champ).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText("Ajout par modèle disponible en ligne.")).toBeVisible();
  await expect(champ).toBeDisabled();

  await context.setOffline(false);
  await expect(champ).toBeEnabled();
});
