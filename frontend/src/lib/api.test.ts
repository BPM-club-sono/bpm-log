import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

describe("ApiError", () => {
  it("conserve le code HTTP et le message", () => {
    const err = new ApiError(404, "Not Found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
    expect(err.name).toBe("ApiError");
  });

  it("est bien une instance d'Error", () => {
    const err = new ApiError(500, "boom");
    expect(err).toBeInstanceOf(Error);
  });
});
