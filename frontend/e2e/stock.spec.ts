import { creerEquipement, expect, test } from "./fixtures";

test("consommable : deltas saisis hors ligne appliqués au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  const eq = await creerEquipement(api, "Piles AA", {
    type: "consommable",
    stock_actuel: 40,
    seuil_alerte: 12,
    unite: "pile",
  });
  const stock = async () =>
    ((await (await api.get(`equipments/${eq.id}`)).json()) as { conso: { stock_actuel: number } })
      .conso.stock_actuel;
  const initial = await stock();

  await page.goto(`/inventaire/${eq.id}`);
  await expect(page.getByRole("heading", { name: "Stock consommable" })).toBeVisible();

  await context.setOffline(true);
  const ajouter = page.getByRole("button", { name: "Ajouter une unité" });
  await ajouter.click();
  await ajouter.click();
  await ajouter.click();
  await page.getByRole("button", { name: "Retirer une unité" }).click();
  await expect(page.getByText("Hors ligne — 4 en attente")).toBeVisible();

  // Le serveur n'a rien reçu tant qu'on est hors ligne.
  expect(await stock()).toBe(initial);

  await context.setOffline(false);
  await expect(page.getByText(/en attente/)).toBeHidden();
  await expect.poll(stock).toBe(initial + 2);
});
