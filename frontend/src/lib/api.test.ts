import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import * as oidc from "./oidc";

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

describe("api() sur 401", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch(...statuses: number[]) {
    const fetchMock = vi.fn();
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(
        new Response(status === 200 ? JSON.stringify({ ok: true }) : "{}", { status }),
      );
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("rejoue la requête après un renouvellement réussi", async () => {
    vi.spyOn(oidc, "getIdToken").mockResolvedValue("tok");
    vi.spyOn(oidc, "renewToken").mockResolvedValue("ok");
    const fetchMock = stubFetch(401, 200);
    expect(await api("/x")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("vide la session si authentik refuse", async () => {
    vi.spyOn(oidc, "getIdToken").mockResolvedValue("tok");
    vi.spyOn(oidc, "renewToken").mockResolvedValue("refused");
    const remove = vi.spyOn(oidc.userManager, "removeUser").mockResolvedValue();
    stubFetch(401);
    await expect(api("/x")).rejects.toMatchObject({ status: 401 });
    expect(remove).toHaveBeenCalled();
  });

  it("garde la session si authentik est injoignable", async () => {
    vi.spyOn(oidc, "getIdToken").mockResolvedValue("tok");
    vi.spyOn(oidc, "renewToken").mockResolvedValue("network");
    const remove = vi.spyOn(oidc.userManager, "removeUser").mockResolvedValue();
    stubFetch(401);
    await expect(api("/x")).rejects.toBeInstanceOf(ApiError);
    expect(remove).not.toHaveBeenCalled();
  });
});
