import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoViewer } from "./PhotoViewer";

const PHOTOS = ["/a.jpg", "/b.jpg", "/c.jpg"];

describe("PhotoViewer", () => {
  it("ne rend rien tant qu'aucune photo n'est ouverte", () => {
    render(<PhotoViewer photos={PHOTOS} index={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ouvre sur la photo demandée et navigue avec les flèches", () => {
    render(<PhotoViewer photos={PHOTOS} index={1} onClose={() => {}} />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Photo suivante"));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Photo suivante")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Photo précédente"));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("navigue au clavier et se ferme avec Échap", () => {
    const onClose = vi.fn();
    render(<PhotoViewer photos={PHOTOS} index={0} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("masque compteur et flèches pour une photo unique", () => {
    render(<PhotoViewer photos={["/a.jpg"]} index={0} onClose={() => {}} />);
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Photo suivante")).not.toBeInTheDocument();
  });

  it("bloque le défilement de la page tant qu'elle est ouverte", () => {
    const { unmount } = render(<PhotoViewer photos={PHOTOS} index={0} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
