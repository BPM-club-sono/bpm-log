import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPeriode, temporalite } from "./prestationDate";

// On fige « aujourd'hui » au 12 juin 2026 (midi local) pour des tests stables.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 12, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("temporalite", () => {
  it("renvoie null quand aucune date", () => {
    expect(temporalite(null, null)).toBeNull();
  });

  it("à venir quand le début est dans le futur", () => {
    expect(temporalite("2026-06-15", "2026-06-16")).toBe("a_venir");
  });

  it("en cours quand aujourd'hui est dans la plage (bornes incluses)", () => {
    expect(temporalite("2026-06-10", "2026-06-14")).toBe("en_cours");
    expect(temporalite("2026-06-12", "2026-06-12")).toBe("en_cours");
  });

  it("passée quand la fin est dépassée", () => {
    expect(temporalite("2026-06-01", "2026-06-05")).toBe("passee");
  });

  it("début seul : en cours dès qu'il est atteint, sinon à venir", () => {
    expect(temporalite("2026-06-10", null)).toBe("en_cours");
    expect(temporalite("2026-06-20", null)).toBe("a_venir");
  });

  it("fin seule : à venir tant qu'elle n'est pas dépassée, sinon passée", () => {
    expect(temporalite(null, "2026-06-20")).toBe("a_venir");
    expect(temporalite(null, "2026-06-05")).toBe("passee");
  });
});

describe("formatPeriode", () => {
  it("affiche une plage", () => {
    expect(formatPeriode("2026-06-12", "2026-06-14")).toBe("12 juin → 14 juin");
  });

  it("affiche une seule borne quand l'autre manque", () => {
    expect(formatPeriode("2026-06-12", null)).toBe("12 juin");
    expect(formatPeriode(null, "2026-06-14")).toBe("14 juin");
  });

  it("affiche un seul jour quand début == fin", () => {
    expect(formatPeriode("2026-06-12", "2026-06-12")).toBe("12 juin");
  });

  it("renvoie null sans date", () => {
    expect(formatPeriode(null, null)).toBeNull();
  });

  it("ne décale pas le jour hors UTC (parse local)", () => {
    // new Date('2026-06-12') serait UTC minuit → 11 juin dans les fuseaux négatifs ;
    // parseJour construit une date locale, donc toujours le 12.
    expect(formatPeriode("2026-06-12", null)).toBe("12 juin");
  });
});
