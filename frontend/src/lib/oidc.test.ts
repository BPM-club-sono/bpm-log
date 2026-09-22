import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorResponse, ErrorTimeout, type User } from "oidc-client-ts";
import { getIdToken, renewToken, userManager } from "./oidc";

function fakeUser(over: Partial<User> = {}): User {
  return { id_token: "id-1", refresh_token: "rt-1", expired: false, ...over } as User;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getIdToken", () => {
  it("rend le token courant s'il est valide, sans renouveler", async () => {
    vi.spyOn(userManager, "getUser").mockResolvedValue(fakeUser());
    const silent = vi.spyOn(userManager, "signinSilent");
    expect(await getIdToken()).toBe("id-1");
    expect(silent).not.toHaveBeenCalled();
  });

  it("renouvelle via le refresh_token quand le token est expiré", async () => {
    const getUser = vi
      .spyOn(userManager, "getUser")
      .mockResolvedValueOnce(fakeUser({ expired: true })) // getIdToken
      .mockResolvedValueOnce(fakeUser({ expired: true })) // doRenew
      .mockResolvedValue(fakeUser({ id_token: "id-2" }));
    vi.spyOn(userManager, "signinSilent").mockResolvedValue(fakeUser({ id_token: "id-2" }));
    expect(await getIdToken()).toBe("id-2");
    expect(getUser).toHaveBeenCalled();
  });

  it("rend null si expiré et sans refresh_token", async () => {
    vi.spyOn(userManager, "getUser").mockResolvedValue(
      fakeUser({ expired: true, refresh_token: undefined }),
    );
    const silent = vi.spyOn(userManager, "signinSilent");
    expect(await getIdToken()).toBeNull();
    expect(silent).not.toHaveBeenCalled();
  });
});

describe("renewToken", () => {
  it("partage un seul renouvellement entre appels concurrents", async () => {
    vi.spyOn(userManager, "getUser").mockResolvedValue(fakeUser());
    const silent = vi
      .spyOn(userManager, "signinSilent")
      .mockResolvedValue(fakeUser({ id_token: "id-2" }));
    const results = await Promise.all([renewToken(), renewToken(), renewToken()]);
    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(silent).toHaveBeenCalledTimes(1);
  });

  it("classe un refus d'authentik en `refused`", async () => {
    vi.spyOn(userManager, "getUser").mockResolvedValue(fakeUser());
    vi.spyOn(userManager, "signinSilent").mockRejectedValue(
      new ErrorResponse({ error: "invalid_grant" }),
    );
    expect(await renewToken()).toBe("refused");
  });

  it("classe une panne réseau en `network`", async () => {
    vi.spyOn(userManager, "getUser").mockResolvedValue(fakeUser());
    vi.spyOn(userManager, "signinSilent").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await renewToken()).toBe("network");
  });

  it("timeout : réseau avec refresh_token, refus sans (iframe bloquée)", async () => {
    vi.spyOn(userManager, "signinSilent").mockRejectedValue(new ErrorTimeout("timeout"));
    const getUser = vi.spyOn(userManager, "getUser").mockResolvedValue(fakeUser());
    expect(await renewToken()).toBe("network");
    getUser.mockResolvedValue(fakeUser({ refresh_token: undefined }));
    expect(await renewToken()).toBe("refused");
  });

  it("n'essaie pas hors ligne", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const silent = vi.spyOn(userManager, "signinSilent");
    expect(await renewToken()).toBe("network");
    expect(silent).not.toHaveBeenCalled();
  });
});
