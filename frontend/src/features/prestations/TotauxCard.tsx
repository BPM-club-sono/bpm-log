import { formatConnectiques, formatNombre, formatPrix } from "@/features/specs/format";
import type { TotauxPresta } from "@/lib/types";
import { libelleManquants } from "./totaux";

function Partiel({ nb, quoi }: { nb: number; quoi: "poids" | "prix" }) {
  const libelle = libelleManquants(nb, quoi);
  if (!libelle) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
      <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
        partiel
      </span>
      {libelle}
    </span>
  );
}

export function TotauxCard({ totaux }: { totaux: TotauxPresta }) {
  const entrees = totaux.connectiques.filter((c) => c.sens === "entree");
  const sorties = totaux.connectiques.filter((c) => c.sens === "sortie");
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-bg-soft p-3"
      data-testid="totaux-card"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">Poids total</span>
          <span className="text-base font-semibold" data-testid="totaux-poids">
            {formatNombre(totaux.poids_total, "kg")}
          </span>
          <Partiel nb={totaux.nb_sans_poids} quoi="poids" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">
            Prix total · tarif {totaux.tarif}
          </span>
          <span className="text-base font-semibold" data-testid="totaux-prix">
            {formatPrix(totaux.prix_total)}
          </span>
          <Partiel nb={totaux.nb_sans_prix} quoi="prix" />
        </div>
      </div>
      {(entrees.length > 0 || sorties.length > 0) && (
        <dl className="space-y-1 text-xs">
          {entrees.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-14 flex-none text-fg-muted">Entrées</dt>
              <dd data-testid="totaux-entrees">{formatConnectiques(entrees)}</dd>
            </div>
          )}
          {sorties.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-14 flex-none text-fg-muted">Sorties</dt>
              <dd data-testid="totaux-sorties">{formatConnectiques(sorties)}</dd>
            </div>
          )}
        </dl>
      )}
      {totaux.fige && (
        <p className="text-[11px] italic text-fg-muted">Figé à la clôture</p>
      )}
    </section>
  );
}
