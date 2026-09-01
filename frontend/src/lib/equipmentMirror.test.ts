import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "./db";
import {
  findByBarcode,
  mergeEquipments,
  mirrorCount,
  refreshEquipmentMirror,
  replaceEquipments,
} from "./equipmentMirror";
import type { MirrorableEquipment } from "./equipmentMirror";

vi.mock("./api", () => ({ api: vi.fn() }));
const { api } = await import("./api");

function eq(id: number, barcode: string, nom = `Item ${id}`): MirrorableEquipment {
  return { id, barcode_uid: barcode, nom, statut_actuel: "Fonctionnel" };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("equipmentMirror", () => {
  beforeEach(async () => {
    await db.equipments.clear();
    vi.mocked(api).mockReset();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it("résout un code-barres mirroré", async () => {
    await mergeEquipments([eq(1, "BPM-000001"), eq(2, "BPM-000002")]);

    const found = await findByBarcode("BPM-000002");
    expect(found?.id).toBe(2);
    expect(found?.nom).toBe("Item 2");
  });

  it("rend null pour un code absent ou vide", async () => {
    await mergeEquipments([eq(1, "BPM-000001")]);

    expect(await findByBarcode("BPM-999999")).toBeNull();
    expect(await findByBarcode("   ")).toBeNull();
  });

  it("tolère les espaces autour du code scanné", async () => {
    await mergeEquipments([eq(1, "BPM-000001")]);

    expect((await findByBarcode("  BPM-000001 "))?.id).toBe(1);
  });

  it("mergeEquipments met à jour sans supprimer les autres", async () => {
    await mergeEquipments([eq(1, "BPM-000001", "Ancien nom"), eq(2, "BPM-000002")]);
    await mergeEquipments([eq(1, "BPM-000001", "Nouveau nom")]);

    expect((await findByBarcode("BPM-000001"))?.nom).toBe("Nouveau nom");
    expect(await findByBarcode("BPM-000002")).not.toBeNull();
    expect(await mirrorCount()).toBe(2);
  });

  it("replaceEquipments purge les équipements disparus du parc", async () => {
    await replaceEquipments([eq(1, "BPM-000001"), eq(2, "BPM-000002")]);
    await replaceEquipments([eq(1, "BPM-000001")]);

    expect(await findByBarcode("BPM-000002")).toBeNull();
    expect(await mirrorCount()).toBe(1);
  });

  it("accepte un code réattribué à un autre équipement", async () => {
    await replaceEquipments([eq(5, "BPM-000005")]);
    // Le serveur a réattribué le code : le miroir doit suivre sans planter
    // (index barcode_uid non-unique côté cache).
    await mergeEquipments([eq(9, "BPM-000005", "Repris")]);

    expect(await mirrorCount()).toBe(2);
  });

  it("refreshEquipmentMirror ne touche pas au réseau hors ligne", async () => {
    await mergeEquipments([eq(1, "BPM-000001")]);
    setOnline(false);

    await refreshEquipmentMirror();

    expect(api).not.toHaveBeenCalled();
    // Le miroir précédent survit.
    expect(await findByBarcode("BPM-000001")).not.toBeNull();
  });

  it("refreshEquipmentMirror remplace le miroir depuis l'API", async () => {
    await mergeEquipments([eq(1, "BPM-000001")]);
    vi.mocked(api).mockResolvedValue([eq(7, "BPM-000007")]);

    await refreshEquipmentMirror();

    expect(api).toHaveBeenCalledWith("/equipments");
    expect(await findByBarcode("BPM-000007")).not.toBeNull();
    expect(await findByBarcode("BPM-000001")).toBeNull();
  });

  it("garde le miroir précédent si l'API échoue", async () => {
    await mergeEquipments([eq(1, "BPM-000001")]);
    vi.mocked(api).mockRejectedValue(new Error("network"));

    await refreshEquipmentMirror();

    expect(await findByBarcode("BPM-000001")).not.toBeNull();
  });
});
