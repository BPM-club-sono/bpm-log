import { describe, expect, it } from "vitest";
import { formatConnectiques, formatNombre, formatPrix, parseNombre } from "./format";

describe("parseNombre", () => {
  it("accepte virgule et point, espaces ignorés", () => {
    expect(parseNombre("1,5")).toBe(1.5);
    expect(parseNombre(" 2.25 ")).toBe(2.25);
  });
  it("vide → null, invalide → NaN", () => {
    expect(parseNombre("")).toBeNull();
    expect(Number.isNaN(parseNombre("abc"))).toBe(true);
  });
});

describe("formatNombre", () => {
  it("formate en français avec unité", () => {
    expect(formatNombre(1.5, "kg")).toBe("1,5 kg");
    expect(formatNombre(null)).toBe("—");
  });
});

describe("formatPrix", () => {
  it("entier sans décimales, sinon 2 décimales", () => {
    expect(formatPrix(12.5)).toBe("12,50 €");
    expect(formatPrix(30)).toBe("30 €");
    expect(formatPrix(null)).toBe("—");
  });
});

describe("formatConnectiques", () => {
  it("liste quantité× nom", () => {
    expect(
      formatConnectiques([
        { connecteur_nom: "PowerCon", quantite: 1 },
        { connecteur_nom: "DMX 3p Male", quantite: 2 },
      ]),
    ).toBe("1× PowerCon, 2× DMX 3p Male");
  });
});
