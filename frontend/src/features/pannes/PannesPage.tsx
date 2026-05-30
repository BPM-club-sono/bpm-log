import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { syncEngine } from "@/lib/syncEngine";
import { compressImage } from "@/lib/image";
import type { Equipment, TicketDetail } from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";

interface LocalPhoto {
  id: string;
  blob: Blob;
  url: string;
}

function newId(): string {
  return crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function PannesPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [barcode, setBarcode] = useState(params.get("barcode") ?? "");
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [checking, setChecking] = useState(false);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Vérifie l'existence de l'équipement (best-effort, échoue silencieusement offline).
  useEffect(() => {
    const code = barcode.trim();
    if (!code) {
      setEquipment(null);
      return;
    }
    let active = true;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const eq = await api<Equipment>(
          `/equipments/by-barcode/${encodeURIComponent(code)}`,
        );
        if (active) setEquipment(eq);
      } catch (err) {
        if (active) setEquipment(null);
        void (err instanceof ApiError);
      } finally {
        if (active) setChecking(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [barcode]);

  // Libère les object URLs.
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  function onPickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const added = files.map((f) => ({
      id: newId(),
      blob: f,
      url: URL.createObjectURL(f),
    }));
    setPhotos((prev) => [...prev, ...added]);
    e.target.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setSaving(true);

    // En ligne : création directe → id immédiat + fiche accessible.
    if (navigator.onLine) {
      try {
        const ticket = await api<TicketDetail>("/tickets", {
          method: "POST",
          body: {
            equipment_id: equipment?.id ?? null,
            barcode_uid: equipment ? null : code,
            description_panne: description.trim() || null,
          },
        });
        for (const p of photos) {
          try {
            const compressed = await compressImage(
              new File([p.blob], "photo.jpg", { type: p.blob.type }),
            );
            const form = new FormData();
            form.append("file", compressed, "photo.jpg");
            await api(`/tickets/${ticket.id}/photos`, {
              method: "POST",
              body: form,
            });
          } catch {
            // Photo non critique : on continue.
          }
        }
        setCreatedId(ticket.id);
        setSubmitted(true);
        return;
      } catch (err) {
        // Équipement introuvable côté serveur : on remonte l'erreur.
        if (err instanceof ApiError && err.status === 404) {
          setSaving(false);
          alert("Équipement introuvable. Vérifie le code-barres.");
          return;
        }
        // Autre erreur réseau : on bascule sur la file hors-ligne.
      } finally {
        setSaving(false);
      }
    }

    // Hors-ligne (ou échec réseau) : on met en file de synchronisation.
    const ticketUuid = await syncEngine.enqueue("ticket_reparation", {
      barcode_uid: code,
      description_panne: description.trim() || null,
    });

    // Photos conservées en blob, uploadées séparément après sync du ticket.
    if (photos.length) {
      const createdAt = new Date().toISOString();
      await db.photos_blob.bulkAdd(
        photos.map((p) => ({
          id: p.id,
          ticket_uuid: ticketUuid,
          blob: p.blob,
          created_at: createdAt,
          uploaded: 0 as const,
        })),
      );
    }

    setCreatedId(null);
    setSubmitted(true);
    setSaving(false);
  }

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setBarcode("");
    setEquipment(null);
    setDescription("");
    setPhotos([]);
    setSubmitted(false);
    setCreatedId(null);
  }

  if (submitted) {
    return (
      <div className="space-y-4 py-8 text-center">
        <Icon name="check_circle" className="text-5xl text-success" />
        <div>
          <h1 className="text-lg font-semibold">Panne enregistrée</h1>
          <p className="text-sm text-fg-muted">
            {createdId
              ? "La fiche de réparation est prête."
              : "Elle sera synchronisée dès que possible."}
          </p>
        </div>
        {createdId && (
          <Button
            className="w-full"
            onClick={() => navigate(`/pannes/${createdId}`)}
          >
            <Icon name="build" className="text-xl" />
            Voir la fiche
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={reset}>
          Déclarer une autre panne
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Déclarer une panne</h1>
        <p className="text-sm text-fg-muted">Fonctionne hors-ligne</p>
      </header>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-fg-muted">
          Code-barres du matériel
        </label>
        <input
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="BPM-LUM-0001"
          className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 font-mono text-sm outline-none focus:border-fg"
        />
        {checking && <p className="text-xs text-fg-muted">Vérification…</p>}
        {equipment && (
          <p className="text-xs text-success">
            <Icon name="check" className="align-middle text-sm" /> {equipment.nom}
          </p>
        )}
        {!checking && !equipment && barcode.trim() && (
          <p className="text-xs text-fg-muted">
            Inconnu en ligne — sera vérifié à la synchro.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-fg-muted">
          Description de la panne
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Symptômes, contexte…"
          className="w-full rounded-xl border border-line bg-bg-soft p-3 text-sm outline-none focus:border-fg"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Photos</label>
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative h-20 w-20">
              <img
                src={p.url}
                alt=""
                className="h-full w-full rounded-lg border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-fg"
              >
                <Icon name="close" className="text-sm" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-fg-muted"
          >
            <Icon name="add_a_photo" className="text-xl" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={onPickPhotos}
          className="hidden"
        />
      </div>

      <Button type="submit" className="w-full" disabled={!barcode.trim()} loading={saving}>
        <Icon name="build" className="text-xl" />
        Enregistrer la panne
      </Button>
    </form>
  );
}
