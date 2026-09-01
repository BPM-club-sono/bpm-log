import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BarcodeInput } from "./BarcodeInput";

function champ() {
  return screen.getByRole("textbox");
}

describe("BarcodeInput", () => {
  it("affiche le préfixe imposé, hors du champ de saisie", () => {
    render(<BarcodeInput value="" onChange={vi.fn()} prefixe="NOV" />);

    expect(screen.getByText("NOV-")).toBeInTheDocument();
    // Le préfixe n'est pas éditable : il identifie le propriétaire et se déduit
    // du contexte, il n'a pas à être saisi.
    expect(champ()).toHaveValue("");
  });

  it("n'accepte que des chiffres", () => {
    const onChange = vi.fn();
    render(<BarcodeInput value="" onChange={onChange} prefixe="BPM" />);

    fireEvent.change(champ(), { target: { value: "a1b2c3" } });

    expect(onChange).toHaveBeenCalledWith("BPM-000123");
  });

  it("complète le numéro à six chiffres", () => {
    const onChange = vi.fn();
    render(<BarcodeInput value="" onChange={onChange} prefixe="BPM" />);

    fireEvent.change(champ(), { target: { value: "42" } });

    expect(onChange).toHaveBeenCalledWith("BPM-000042");
  });

  it("s'arrête à six chiffres — au-delà, la référence ne tiendrait plus", () => {
    const onChange = vi.fn();
    render(<BarcodeInput value="" onChange={onChange} prefixe="BPM" />);

    fireEvent.change(champ(), { target: { value: "12345678" } });

    expect(onChange).toHaveBeenCalledWith("BPM-123456");
  });

  it("rend une saisie vidée comme une absence de référence", () => {
    const onChange = vi.fn();
    render(<BarcodeInput value="BPM-000042" onChange={onChange} prefixe="BPM" />);

    fireEvent.change(champ(), { target: { value: "" } });

    // Chaîne vide et non « BPM- » : l'appelant doit pouvoir distinguer
    // « pas de référence personnalisée » d'une saisie en cours.
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("garde la saisie telle qu'elle est tapée, sans la padder en cours de route", () => {
    // Régression : padder l'affichage à chaque frappe rendait le champ
    // inutilisable — « 1 » devenait « 000001 », qui remplit les six caractères
    // et refuse la frappe suivante.
    render(<BarcodeInput value="" onChange={vi.fn()} prefixe="BPM" />);

    fireEvent.change(champ(), { target: { value: "1" } });
    expect(champ()).toHaveValue("1");

    fireEvent.change(champ(), { target: { value: "12" } });
    expect(champ()).toHaveValue("12");

    fireEvent.change(champ(), { target: { value: "123456" } });
    expect(champ()).toHaveValue("123456");
  });

  it("montre la référence que la saisie produira", () => {
    render(<BarcodeInput value="" onChange={vi.fn()} prefixe="NOV" />);

    fireEvent.change(champ(), { target: { value: "42" } });

    expect(screen.getByText("Référence : NOV-000042")).toBeInTheDocument();
  });

  it("affiche le numéro d'une référence existante", () => {
    render(<BarcodeInput value="BPM-000042" onChange={vi.fn()} prefixe="BPM" />);

    expect(champ()).toHaveValue("000042");
  });

  it("réémet la référence sous le nouveau préfixe quand le contexte change", () => {
    // Cocher « location externe » et choisir un fournisseur change le préfixe :
    // la référence déjà saisie doit suivre.
    const onChange = vi.fn();
    const { rerender } = render(
      <BarcodeInput value="BPM-000042" onChange={onChange} prefixe="BPM" />,
    );

    rerender(<BarcodeInput value="BPM-000042" onChange={onChange} prefixe="NOV" />);

    expect(onChange).toHaveBeenCalledWith("NOV-000042");
  });
});
