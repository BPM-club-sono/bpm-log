import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { compressImage } from "@/lib/image";
import type {
  AvancementTicket,
  MembreLite,
  TicketDetail,
  TicketEvenement,
} from "@/lib/types";
import { Button } from "@/shared/Button";
import { Icon } from "@/shared/Icon";
import { useToast } from "@/shared/Toast";
import { AvancementBadge } from "./PannesListPage";

const AVANCEMENTS: { value: AvancementTicket; label: string }[] = [
  { value: "A_faire", label: "À faire" },
  { value: "En_cours", label: "En cours" },
  { value: "En_attente_de_piece", label: "En attente" },
  { value: "Resolu", label: "Résolu" },
];

function membreNom(m: MembreLite | null): string {
  if (!m) return "—";
  return [m.prenom, m.nom].filter(Boolean).join(" ") || "—";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventMeta(ev: TicketEvenement): { icon: string; text: string } {
  const av = ev.valeur_avant ?? "—";
  const ap = ev.valeur_apres ?? "—";
  switch (ev.type) {
    case "Commentaire":
      return { icon: "chat", text: ev.commentaire ?? "" };
    case "Changement_Statut":
      return { icon: "swap_horiz", text: `Statut : ${av} → ${ap}` };
    case "Changement_Cout":
      return { icon: "euro", text: `Coût : ${av} → ${ap}` };
    case "Ajout_Photo":
      return { icon: "photo_camera", text: "Photo ajoutée" };
    case "Changement_Assignation":
      return { icon: "engineering", text: `Assigné : ${av} → ${ap}` };
    default:
      return { icon: "circle", text: "" };
  }
}

export function TicketDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [membres, setMembres] = useState<MembreLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savingStatut, setSavingStatut] = useState(false);
  const [savingAssigne, setSavingAssigne] = useState(false);
  const [coutInput, setCoutInput] = useState("");
  const [savingCout, setSavingCout] = useState(false);
  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<TicketDetail>(`/tickets/${id}`);
      setTicket(data);
      setCoutInput(data.cout_estime != null ? String(data.cout_estime) : "");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? "Ticket introuvable."
            : "Impossible de charger le ticket."
          : "Erreur réseau. Réessaie.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    api<MembreLite[]>("/membres")
      .then((m) => {
        if (active) setMembres(m);
      })
      .catch(() => {
        /* liste d'assignation optionnelle */
      });
    return () => {
      active = false;
    };
  }, []);

  async function changeAvancement(value: AvancementTicket) {
    if (!ticket || value === ticket.avancement) return;
    setSavingStatut(true);
    try {
      const updated = await api<TicketDetail>(`/tickets/${ticket.id}`, {
        method: "PATCH",
        body: { avancement: value },
      });
      setTicket(updated);
      toast("Avancement mis à jour.", "success");
    } catch {
      toast("Échec de la mise à jour.", "error");
    } finally {
      setSavingStatut(false);
    }
  }

  async function changeAssigne(value: string) {
    if (!ticket) return;
    const assigne_membre_id = value === "" ? null : Number(value);
    setSavingAssigne(true);
    try {
      const updated = await api<TicketDetail>(`/tickets/${ticket.id}`, {
        method: "PATCH",
        body: { assigne_membre_id, set_assigne: true },
      });
      setTicket(updated);
      toast("Assignation mise à jour.", "success");
    } catch {
      toast("Échec de l'assignation.", "error");
    } finally {
      setSavingAssigne(false);
    }
  }

  async function saveCout() {
    if (!ticket) return;
    const trimmed = coutInput.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value != null && Number.isNaN(value)) {
      toast("Montant invalide.", "error");
      return;
    }
    if (value === ticket.cout_estime) return;
    setSavingCout(true);
    try {
      const updated = await api<TicketDetail>(`/tickets/${ticket.id}`, {
        method: "PATCH",
        body: { cout_estime: value },
      });
      setTicket(updated);
      toast("Coût mis à jour.", "success");
    } catch {
      toast("Échec de la mise à jour du coût.", "error");
    } finally {
      setSavingCout(false);
    }
  }

  async function submitComment() {
    if (!ticket) return;
    const texte = comment.trim();
    if (!texte) return;
    setSavingComment(true);
    try {
      const updated = await api<TicketDetail>(
        `/tickets/${ticket.id}/commentaires`,
        { method: "POST", body: { commentaire: texte } },
      );
      setTicket(updated);
      setComment("");
    } catch {
      toast("Échec de l'envoi du commentaire.", "error");
    } finally {
      setSavingComment(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !ticket) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("file", compressed, "photo.jpg");
      const updated = await api<TicketDetail>(`/tickets/${ticket.id}/photos`, {
        method: "POST",
        body: form,
      });
      setTicket(updated);
      toast("Photo ajoutée.", "success");
    } catch {
      toast("Échec de l'ajout de la photo.", "error");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-fg-muted">Chargement…</p>;
  }
  if (error || !ticket) {
    return (
      <div className="space-y-4 py-8 text-center">
        <p className="text-sm text-danger">{error ?? "Ticket introuvable."}</p>
        <Link to="/pannes/liste" className="text-sm text-fg-muted hover:text-fg">
          Retour à la liste
        </Link>
      </div>
    );
  }

  const coutChanged =
    (coutInput.trim() === "" ? null : Number(coutInput)) !== ticket.cout_estime;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">Réparation #{ticket.id}</h1>
          <AvancementBadge avancement={ticket.avancement} />
        </div>
        <Link
          to={`/inventaire/${ticket.equipment_id}`}
          className="-mx-1 flex items-center gap-2 rounded-lg px-1 py-2 transition-opacity hover:opacity-70"
        >
          <Icon name="inventory_2" className="text-xl text-fg-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ticket.equipment_nom}</p>
            <p className="font-mono text-xs text-fg-muted">
              {ticket.equipment_barcode}
            </p>
          </div>
          <Icon name="chevron_right" className="text-fg-muted" />
        </Link>
      </header>

      {/* Méta-données */}
      <section className="divide-y divide-line text-sm">
        <div className="flex justify-between gap-2 py-2">
          <span className="text-fg-muted">Déclarée par</span>
          <span className="font-medium">{membreNom(ticket.declarant)}</span>
        </div>
        <div className="flex justify-between gap-2 py-2">
          <span className="text-fg-muted">Le</span>
          <span>{formatDateTime(ticket.date_declaration)}</span>
        </div>
        {ticket.date_resolution && (
          <div className="flex justify-between gap-2 py-2">
            <span className="text-fg-muted">Résolue le</span>
            <span>{formatDateTime(ticket.date_resolution)}</span>
          </div>
        )}
      </section>

      {ticket.description_panne && (
        <section className="space-y-1.5">
          <h2 className="text-sm font-semibold text-fg-muted">Description</h2>
          <p className="whitespace-pre-wrap text-sm">
            {ticket.description_panne}
          </p>
        </section>
      )}

      {/* Avancement */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Avancement</h2>
        <div className="flex flex-wrap gap-2">
          {AVANCEMENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              disabled={savingStatut}
              onClick={() => changeAvancement(a.value)}
              data-on={ticket.avancement === a.value}
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg-muted disabled:opacity-50 data-[on=true]:border-fg data-[on=true]:bg-bg-elev data-[on=true]:text-fg"
            >
              {a.label}
            </button>
          ))}
        </div>
      </section>

      {/* Assignation */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Assigné à</h2>
        <select
          value={ticket.assigne?.id ?? ""}
          disabled={savingAssigne}
          onChange={(e) => changeAssigne(e.target.value)}
          className="h-11 w-full rounded-xl border border-line bg-bg-soft px-3 text-sm outline-none focus:border-fg disabled:opacity-50"
        >
          <option value="">Non assigné</option>
          {membres.map((m) => (
            <option key={m.id} value={m.id}>
              {membreNom(m)}
            </option>
          ))}
        </select>
      </section>

      {/* Coût estimé */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Coût estimé</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={coutInput}
              onChange={(e) => setCoutInput(e.target.value)}
              placeholder="—"
              className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-3 pr-8 text-sm outline-none focus:border-fg"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
              €
            </span>
          </div>
          {coutChanged && (
            <Button
              type="button"
              className="w-auto px-4"
              loading={savingCout}
              onClick={saveCout}
            >
              Enregistrer
            </Button>
          )}
        </div>
      </section>

      {/* Photos */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg-muted">Photos</h2>
        <div className="flex flex-wrap gap-2">
          {ticket.photos.map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="h-20 w-20"
            >
              <img
                src={p.url}
                alt=""
                className="h-full w-full rounded-lg border border-line object-cover"
              />
            </a>
          ))}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-fg-muted disabled:opacity-50"
          >
            <Icon name={uploading ? "hourglass_empty" : "add_a_photo"} className="text-xl" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickPhoto}
          className="hidden"
        />
      </section>

      {/* Fil d'activité */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-muted">Activité</h2>
        {ticket.evenements.length === 0 && (
          <p className="text-sm text-fg-muted">Aucune activité pour l'instant.</p>
        )}
        <ol className="space-y-3">
          {ticket.evenements.map((ev) => {
            const { icon, text } = eventMeta(ev);
            const isComment = ev.type === "Commentaire";
            return (
              <li key={ev.id} className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line bg-bg-soft text-fg-muted">
                  <Icon name={icon} className="text-base" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      {membreNom(ev.auteur)}
                    </span>
                    <span className="flex-none text-xs text-fg-muted">
                      {formatDateTime(ev.created_at)}
                    </span>
                  </div>
                  <p
                    className={
                      isComment
                        ? "mt-0.5 whitespace-pre-wrap text-sm"
                        : "text-sm text-fg-muted"
                    }
                  >
                    {text}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Nouveau commentaire */}
      <section className="space-y-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Ajouter un commentaire…"
          className="w-full rounded-xl border border-line bg-bg-soft p-3 text-sm outline-none focus:border-fg"
        />
        <Button
          type="button"
          className="w-full"
          loading={savingComment}
          disabled={!comment.trim()}
          onClick={submitComment}
        >
          <Icon name="send" className="text-lg" />
          Commenter
        </Button>
      </section>
    </div>
  );
}
