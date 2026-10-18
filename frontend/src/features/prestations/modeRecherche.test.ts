import { beforeEach, describe, expect, it, vi } from "vitest";
import { ecrireModeRecherche, lireModeRecherche } from "./modeRecherche";

describe("modeRecherche", () => {
  beforeEach(() => localStorage.clear());

  it("vaut « modele » par défaut", () => {
    expect(lireModeRecherche()).toBe("modele");
  });

  it("mémorise le dernier mode choisi", () => {
    ecrireModeRecherche("nom");
    expect(lireModeRecherche()).toBe("nom");
    ecrireModeRecherche("modele");
    expect(lireModeRecherche()).toBe("modele");
  });

  it("retombe sur le défaut si le stockage est indisponible", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqué");
    });
    expect(lireModeRecherche()).toBe("modele");
    expect(() => ecrireModeRecherche("nom")).not.toThrow();
    spy.mockRestore();
  });
});
