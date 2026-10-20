import { describe, expect, it } from "vitest";
import { libelleManquants } from "./totaux";

describe("libelleManquants", () => {
  for (const quoi of ["poids", "prix"] as const) {
    it(`${quoi} : 0 → null`, () => {
      expect(libelleManquants(0, quoi)).toBeNull();
    });
    it(`${quoi} : 1 → singulier`, () => {
      expect(libelleManquants(1, quoi)).toBe(`1 item sans ${quoi}`);
    });
    it(`${quoi} : 3 → pluriel`, () => {
      expect(libelleManquants(3, quoi)).toBe(`3 items sans ${quoi}`);
    });
  }
});
