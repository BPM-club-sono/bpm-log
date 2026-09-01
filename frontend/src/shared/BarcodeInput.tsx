import { useEffect, useId, useState } from "react";
import { LONGUEUR_NUMERO, construire, decomposer } from "@/lib/barcode";

interface BarcodeInputProps {
  /** Référence complète (`PPP-NNNNNN`), ou chaîne vide. */
  value: string;
  onChange: (reference: string) => void;
  /** Trigramme imposé par le contexte : BPM en interne, celui du fournisseur sinon. */
  prefixe: string;
  disabled?: boolean;
}

/** Saisie d'une référence matériel : préfixe figé, numéro libre.
 *
 *  Le préfixe n'est pas éditable parce qu'il identifie le propriétaire et se
 *  déduit du contexte (interne ou loué). Le numéro est purement numérique, ce
 *  qui ouvre le pavé numérique sur mobile — c'est la raison d'être du format :
 *  une référence doit se dicter au téléphone et se taper sans hésiter.
 *
 *  La saisie est gardée telle qu'elle est tapée ; le zéro-padding ne s'applique
 *  qu'à la valeur remontée. Padder l'affichage à chaque frappe rendrait le
 *  champ inutilisable : taper « 1 » afficherait « 000001 », qui remplit déjà
 *  les six caractères et refuse la frappe suivante.
 */
export function BarcodeInput({
  value,
  onChange,
  prefixe,
  disabled = false,
}: BarcodeInputProps) {
  const id = useId();
  const [numero, setNumero] = useState(() => decomposer(value)?.numero ?? "");

  // Le préfixe suit le contexte (choix d'un fournisseur) : la référence déjà
  // saisie doit alors être réémise sous le nouveau préfixe.
  useEffect(() => {
    if (numero) onChange(construire(prefixe, numero));
    // `onChange` et `numero` sont volontairement hors dépendances : on ne veut
    // réagir qu'au changement de préfixe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixe]);

  function onNumeroChange(saisi: string) {
    const chiffres = saisi.replace(/\D/g, "").slice(0, LONGUEUR_NUMERO);
    setNumero(chiffres);
    onChange(chiffres ? construire(prefixe, chiffres) : "");
  }

  return (
    <div className="space-y-1">
      <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-bg-soft focus-within:border-fg">
        <span
          aria-hidden
          className="flex select-none items-center border-r border-line bg-bg-elev px-3 font-mono text-sm text-fg-muted"
        >
          {prefixe}-
        </span>
        <input
          id={id}
          value={numero}
          onChange={(e) => onNumeroChange(e.target.value)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          maxLength={LONGUEUR_NUMERO}
          placeholder="42"
          aria-label={`Numéro de la référence, préfixe ${prefixe}`}
          className="h-11 flex-1 bg-transparent px-3 font-mono text-sm outline-none disabled:opacity-50"
        />
      </div>
      <p className="text-xs text-fg-muted">
        {numero
          ? `Référence : ${construire(prefixe, numero)}`
          : `${LONGUEUR_NUMERO} chiffres, complétés par des zéros (42 donne ${construire(prefixe, "42")}).`}
      </p>
    </div>
  );
}
