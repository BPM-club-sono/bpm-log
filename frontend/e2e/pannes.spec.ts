import { creerEquipement, expect, test } from "./fixtures";

interface TicketListItem {
  id: number;
  equipment_id: number;
  description_panne: string | null;
}

test("déclaration en ligne → fiche de réparation", async ({ page, api }) => {
  const eq = await creerEquipement(api, "Enceinte RCF ART 745");
  const description = `Grésille à fort volume ${Date.now()}`;

  await page.goto("/pannes");
  await page.getByPlaceholder("Nom ou code-barres…").fill(eq.nom);
  await page.getByRole("button", { name: new RegExp(eq.nom) }).click();
  await page.getByPlaceholder("Symptômes, contexte…").fill(description);
  await page.getByRole("button", { name: "Enregistrer la panne" }).click();

  await expect(page.getByText("La fiche de réparation est prête.")).toBeVisible();
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  await expect(page.getByRole("heading", { name: /^Réparation #\d+$/ })).toBeVisible();
  await expect(page.getByText(description)).toBeVisible();
});

test("déclaration hors ligne → mise en file puis synchronisée au retour du réseau", async ({
  page,
  context,
  api,
}) => {
  const eq = await creerEquipement(api, "Pied de levage 4m");
  const description = `Manivelle bloquée ${Date.now()}`;

  await page.goto("/pannes");
  await expect(page.getByRole("heading", { name: "Déclarer une panne" })).toBeVisible();

  await context.setOffline(true);
  await page.getByPlaceholder("Nom ou code-barres…").fill(eq.barcode_uid);
  await page.getByPlaceholder("Symptômes, contexte…").fill(description);
  await page.getByRole("button", { name: "Enregistrer la panne" }).click();

  await expect(page.getByText("Elle sera synchronisée dès que possible.")).toBeVisible();
  await expect(page.getByText("Hors ligne — 1 en attente")).toBeVisible();

  // Retour du réseau : l'évènement `online` déclenche le flush de la file.
  const synchro = page.waitForResponse(
    (r) => r.url().endsWith("/api/sync/batch") && r.request().method() === "POST",
  );
  await context.setOffline(false);
  const reponse = await synchro;
  expect(reponse.status()).toBe(200);
  expect((await reponse.json()).conflicts).toEqual([]);

  await expect(page.getByText(/en attente/)).toBeHidden();
  const tickets = (await (await api.get("tickets?statut=tous")).json()) as TicketListItem[];
  expect(tickets).toContainEqual(
    expect.objectContaining({ equipment_id: eq.id, description_panne: description }),
  );
});
