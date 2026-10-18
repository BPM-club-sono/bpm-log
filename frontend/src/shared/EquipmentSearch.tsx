import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { EquipmentListItem } from "@/lib/types";
import { Icon } from "./Icon";
import { SearchInput } from "./SearchInput";
import { StatusBadge } from "./StatusBadge";

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 300;

interface EquipmentSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (eq: EquipmentListItem) => void;
  placeholder?: string;
  /** Faux : pas de recherche ni de liste (ex. équipement déjà choisi). */
  enabled?: boolean;
  /** Équipements à ne pas proposer (ex. déjà alloués). */
  excludeIds?: ReadonlySet<number>;
  disabled?: boolean;
  /** Affiché quand le texte saisi ne donne aucun résultat. */
  emptyHint?: ReactNode;
  /** Complément de la ligne code-barres (ex. « contenu inclus »). */
  renderMeta?: (eq: EquipmentListItem) => string | null;
  /** Côté droit de chaque résultat ; le statut par défaut. */
  renderTrailing?: (eq: EquipmentListItem) => ReactNode;
  /** Paramètres ajoutés à la requête (ex. `pour_presta=12`). */
  extraQuery?: string;
  /** Raison pour laquelle un résultat n'est pas sélectionnable (grisé), sinon null. */
  indisponible?: (eq: EquipmentListItem) => string | null;
  /** Remplace la loupe par un bouton (ex. bascule de mode). */
  icon?: string;
  onIconClick?: () => void;
  iconLabel?: string;
}

/** Recherche serveur du parc (nom ou code-barres), debounce 300 ms.
 *
 *  En ligne seulement : hors ligne la saisie reste du texte libre, à charge de
 *  l'écran appelant d'en faire quelque chose (ex. code-barres mis en file). */
export function EquipmentSearch({
  value,
  onChange,
  onSelect,
  placeholder = "Nom ou code-barres…",
  enabled = true,
  excludeIds,
  disabled = false,
  emptyHint,
  renderMeta,
  renderTrailing = (e) => <StatusBadge statut={e.statut_actuel} />,
  extraQuery,
  indisponible,
  icon,
  onIconClick,
  iconLabel,
}: EquipmentSearchProps) {
  const [results, setResults] = useState<EquipmentListItem[]>([]);
  const q = value.trim();

  useEffect(() => {
    if (!q || !enabled || !navigator.onLine) {
      setResults([]);
      return;
    }
    // Une réponse lente ne doit pas écraser celle d'une frappe plus récente.
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api<EquipmentListItem[]>(
          `/equipments?q=${encodeURIComponent(q)}${extraQuery ? `&${extraQuery}` : ""}`,
        );
        if (stale) return;
        setResults(
          r.filter((e) => !excludeIds?.has(e.id)).slice(0, MAX_RESULTS),
        );
      } catch {
        if (!stale) setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, enabled, excludeIds, extraQuery]);

  const visible = enabled ? results : [];

  return (
    <div className="space-y-1.5">
      <SearchInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        icon={icon}
        onIconClick={onIconClick}
        iconLabel={iconLabel}
      />
      {visible.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg-soft">
          {visible.map((e) => {
            const meta = renderMeta?.(e);
            const raison = indisponible?.(e) ?? null;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={disabled || raison !== null}
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-opacity hover:opacity-70 disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {e.est_contenant && (
                        <Icon name="inventory_2" className="text-sm text-fg-muted" />
                      )}
                      {e.nom}
                    </p>
                    <p className="font-mono text-xs text-fg-muted">
                      {e.barcode_uid}
                      {meta ? ` · ${meta}` : ""}
                    </p>
                  </div>
                  {raison !== null ? (
                    <span className="flex-none rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">
                      {raison}
                    </span>
                  ) : (
                    renderTrailing(e)
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {enabled && q && visible.length === 0 && emptyHint && (
        <p className="text-xs text-fg-muted">{emptyHint}</p>
      )}
    </div>
  );
}
