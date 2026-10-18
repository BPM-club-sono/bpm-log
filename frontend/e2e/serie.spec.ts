import { randomUUID } from "node:crypto";
import { creerEquipement, creerModele, expect, test } from "./fixtures";

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

test("Prestation clôturée : archive les locations rendues seulement", async ({ page, api }) => {
  const loueur = `Loueur ${randomUUID().slice(0, 8)}`;
  const a = await creerEquipement(api, "Loc A", { externe: true, fournisseur_nom: loueur });
  const b = await creerEquipement(api, "Loc B", { externe: true, fournisseur_nom: loueur });
  const presta = await (
    await api.post("prestations", { data: { nom: `Presta ${randomUUID().slice(0, 8)}` } })
  ).json();
  const alloc: Record<number, number> = {};
  for (const eq of [a, b]) {
    const res = await api.post(`prestations/${presta.id}/allocations`, {
      data: { equipment_id: eq.id },
    });
    expect(res.status()).toBe(201);
  }
  const detail = await (await api.get(`prestations/${presta.id}`)).json();
  for (const al of detail.allocations) alloc[al.equipment_id] = al.id;

  const t0 = Date.now();
  const evt = (equipment_id: number, sens: "sortie" | "retour", i: number) => ({
    uuid_client: randomUUID(),
    type: "presta_check",
    offline_created_at: new Date(t0 + i * 1000).toISOString(),
    payload: { presta_id: presta.id, equipment_id, sens, delta: 1 },
  });
  const sync = await api.post("sync/batch", {
    data: { items: [evt(a.id, "sortie", 0), evt(a.id, "retour", 1), evt(b.id, "sortie", 2)] },
  });
  expect(sync.ok()).toBeTruthy();
  // Le retour archive déjà la location au pointage : on la désarchive pour retrouver le
  // cas de l'archivage en lot (location rendue avant que la règle existe, ou restaurée).
  expect((await api.post(`equipments/${a.id}/desarchive`)).ok()).toBeTruthy();
  const clo = await api.post(`prestations/${presta.id}/cloture`, {
    data: { items: [{ allocation_id: alloc[b.id], decision: "perdu" }] },
  });
  expect(clo.ok()).toBeTruthy();

  await page.goto(`/prestations/${presta.id}`);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Archiver les locations rendues (1)" }).click();
  await expect(page.getByText("1 location archivée")).toBeVisible();

  expect((await (await api.get(`equipments/${a.id}`)).json()).archive).toBe(true);
  expect((await (await api.get(`equipments/${b.id}`)).json()).archive).toBe(false);
});
