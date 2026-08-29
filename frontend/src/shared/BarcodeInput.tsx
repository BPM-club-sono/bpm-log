import { useId } from "react";
import { LONGUEUR_NUMERO, construire, decomposer } from "@/lib/barcode";
import { Icon } from "@/shared/Icon";

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
 */
export function BarcodeInput({
  value,
  onChange,
  prefixe,
  disabled = false,
}: BarcodeInputProps) {
  const id = useId();
  const numero = decomposer(value)?.numero ?? "";

  function onNumeroChange(saisi: string) {
    const chiffres = saisi.replace(/\D/g, "").slice(0, LONGUEUR_NUMERO);
    onChange(chiffres ? construire(prefixe, chiffres) : "");
  }

  const incomplet = numero.length > 0 && numero.length < LONGUEUR_NUMERO;

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
          placeholder="000042"
          aria-label={`Numéro de la référence, préfixe ${prefixe}`}
          className="h-11 flex-1 bg-transparent px-3 font-mono text-sm outline-none disabled:opacity-50"
        />
      </div>
      {incomplet && (
        <p className="flex items-center gap-1 text-xs text-warning">
          <Icon name="info" className="text-sm" />
          {LONGUEUR_NUMERO} chiffres attendus.
        </p>
      )}
    </div>
  );
}
