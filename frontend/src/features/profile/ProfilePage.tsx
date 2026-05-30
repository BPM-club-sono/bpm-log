import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/app/AuthContext";
import { ApiError } from "@/lib/api";
import {
  deletePasskey,
  listPasskeys,
  passkeySupported,
  registerPasskey,
  type Passkey,
} from "@/lib/webauthn";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [deviceName, setDeviceName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = passkeySupported();

  const loadKeys = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
    } catch {
      // silencieux : section optionnelle
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    if (supported) void loadKeys();
    else setLoadingKeys(false);
  }, [supported, loadKeys]);

  if (!user) return null;
  const fullName = [user.prenom, user.nom].filter(Boolean).join(" ") || user.email;

  async function onRegister() {
    setError(null);
    setRegistering(true);
    try {
      await registerPasskey(deviceName || "Cet appareil");
      setDeviceName("");
      await loadKeys();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Cette Passkey est déjà enregistrée.");
      } else if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Enregistrement annulé.");
      } else {
        setError("Impossible d'enregistrer la Passkey.");
      }
    } finally {
      setRegistering(false);
    }
  }

  async function onDelete(id: number) {
    setPasskeys((prev) => prev.filter((k) => k.id !== id));
    try {
      await deletePasskey(id);
    } catch {
      await loadKeys();
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profil</h1>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-bg-soft">
        <Row label="Nom" value={fullName} />
        <Row label="Email" value={user.email} />
        <Row label="Rôle" value={user.role} />
      </dl>

      {supported && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="passkey" className="text-xl" />
            <h2 className="text-sm font-semibold">Passkeys</h2>
          </div>
          <p className="text-xs text-fg-muted">
            Connecte-toi sans mot de passe avec l'empreinte ou le code de cet appareil.
          </p>

          {!loadingKeys && passkeys.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-bg-soft">
              {passkeys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {k.device_name ?? "Appareil"}
                    </p>
                    <p className="text-xs text-fg-muted">
                      Ajoutée le{" "}
                      {new Date(k.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDelete(k.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-danger"
                    aria-label="Supprimer la Passkey"
                  >
                    <Icon name="delete" className="text-lg" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Nom de l'appareil (optionnel)"
              className="h-11 flex-1 rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg"
            />
            <Button onClick={onRegister} loading={registering} className="shrink-0">
              <Icon name="add" className="text-base" />
              Ajouter
            </Button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </section>
      )}

      <Button variant="ghost" className="w-full" onClick={logout}>
        Se déconnecter
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
