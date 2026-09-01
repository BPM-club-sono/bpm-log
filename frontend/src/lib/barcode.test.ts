import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import {
  PREFIXE_EXTERNE,
  PREFIXE_INTERNE,
  construire,
  decomposer,
  estConforme,
  estTrigrammeValide,
  normaliser,
} from "./barcode";

/** La garantie qui justifie tout le format : le symbole doit rester en v1. */
function version(contenu: string): number {
  return QRCode.create(contenu, { errorCorrectionLevel: "H" }).version;
}

describe("format des références", () => {
  it("tient en QR version 1 avec correction H", () => {
    for (const prefixe of [PREFIXE_INTERNE, PREFIXE_EXTERNE, "NOV", "TST"]) {
      for (const numero of ["000001", "042042", "999999"]) {
        const reference = construire(prefixe, numero);
        expect(reference).toHaveLength(10);
        expect(version(reference)).toBe(1);
      }
    }
  });

  it("reste en mode alphanumérique — une minuscule ferait passer en v2", () => {
    // C'est la raison pour laquelle les références sont en majuscules : le mode
    // alphanumérique QR n'accepte pas les minuscules, qui basculent en Byte.
    expect(version("BPM-000042")).toBe(1);
    expect(version("bpm-000042")).toBe(2);
  });

  it("une référence au format historique déborde", () => {
    // 12 caractères : ce que la refonte élimine.
    expect(version("BPM-LUM-0001")).toBe(2);
  });

  it("normalise la casse et les espaces d'une saisie", () => {
    expect(normaliser("  bpm-000042 ")).toBe("BPM-000042");
    expect(normaliser("Nov-000117")).toBe("NOV-000117");
  });

  it("complète le numéro à six chiffres", () => {
    expect(construire("BPM", "42")).toBe("BPM-000042");
    expect(construire("BPM", "000042")).toBe("BPM-000042");
  });

  it("reconnaît le format", () => {
    expect(estConforme("BPM-000042")).toBe(true);
    expect(estConforme("BPM-LUM-0001")).toBe(false);
    expect(estConforme("bpm-000042")).toBe(false);
    expect(estConforme("BP-000042")).toBe(false);
    expect(estConforme("BPM-00042")).toBe(false);
  });

  it("valide un trigramme", () => {
    expect(estTrigrammeValide("NOV")).toBe(true);
    expect(estTrigrammeValide("NO")).toBe(false);
    expect(estTrigrammeValide("NO1")).toBe(false);
    expect(estTrigrammeValide("nov")).toBe(false);
  });

  it("sépare préfixe et numéro, en tolérant une saisie non normalisée", () => {
    expect(decomposer("NOV-000117")).toEqual({ prefixe: "NOV", numero: "000117" });
    expect(decomposer(" nov-000117 ")).toEqual({ prefixe: "NOV", numero: "000117" });
    expect(decomposer("BPM-LUM-0001")).toBeNull();
    expect(decomposer("")).toBeNull();
  });
});
