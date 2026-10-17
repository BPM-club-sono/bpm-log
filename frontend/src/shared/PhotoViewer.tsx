import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface PhotoViewerProps {
  /** URLs des photos (servies par l'API ou `blob:` locales). */
  photos: string[];
  /** Index de la photo ouverte ; `null` = visionneuse fermée. */
  index: number | null;
  onClose: () => void;
}

/**
 * Visionneuse plein écran façon « Photos » : balayage gauche/droite entre les
 * photos, pincement ou double-tap pour zoomer (puis glisser pour se déplacer),
 * flèches et clavier (← → Échap) sur ordinateur.
 */
export function PhotoViewer({ photos, index, onClose }: PhotoViewerProps) {
  if (index === null || photos.length === 0) return null;
  return createPortal(
    <Viewer photos={photos} start={Math.min(index, photos.length - 1)} onClose={onClose} />,
    document.body,
  );
}

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** Fraction de la largeur à balayer pour changer de photo. */
const SWIPE_RATIO = 0.18;
/** Déplacement (px) au-delà duquel un appui n'est plus un tap. */
const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 300;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface Gesture {
  pointers: Map<number, { x: number; y: number }>;
  startX: number;
  startY: number;
  startT: number;
  moved: boolean;
  /** Position du zoom au début du glissement. */
  panX: number;
  panY: number;
  pinchDist: number;
  pinchScale: number;
  lastTap: number;
}

function Viewer({
  photos,
  start,
  onClose,
}: {
  photos: string[];
  start: number;
  onClose: () => void;
}) {
  const count = photos.length;
  const [current, setCurrent] = useState(start);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM);
  const zoomRef = useRef<Zoom>(NO_ZOOM);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture>({
    pointers: new Map(),
    startX: 0,
    startY: 0,
    startT: 0,
    moved: false,
    panX: 0,
    panY: 0,
    pinchDist: 1,
    pinchScale: 1,
    lastTap: 0,
  });

  // La liste peut rétrécir pendant l'affichage (photo supprimée).
  const idx = Math.min(current, count - 1);

  const setZoom = useCallback((z: Zoom) => {
    zoomRef.current = z;
    setZoomState(z);
  }, []);

  const step = useCallback(
    (delta: number) => {
      setCurrent((c) => clamp(c + delta, 0, count - 1));
      setZoom(NO_ZOOM);
    },
    [count, setZoom],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  // Bloque le défilement de la page et rend le focus à l'élément d'origine.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  /** Empêche de faire sortir l'image zoomée du cadre. */
  function clampPan(z: Zoom): Zoom {
    const w = stageRef.current?.clientWidth ?? window.innerWidth;
    const h = stageRef.current?.clientHeight ?? window.innerHeight;
    const maxX = (w * (z.scale - 1)) / 2;
    const maxY = (h * (z.scale - 1)) / 2;
    return { scale: z.scale, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) };
  }

  function anchor(x: number, y: number) {
    const g = gesture.current;
    g.startX = x;
    g.startY = y;
    g.panX = zoomRef.current.x;
    g.panY = zoomRef.current.y;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 1) {
      anchor(e.clientX, e.clientY);
      g.startT = Date.now();
      g.moved = false;
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.pinchScale = zoomRef.current.scale;
      g.moved = true;
      setDx(0);
    }
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const scale = clamp(
        (g.pinchScale * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinchDist,
        1,
        MAX_ZOOM,
      );
      setZoom(clampPan({ ...zoomRef.current, scale }));
      return;
    }

    const ddx = e.clientX - g.startX;
    const ddy = e.clientY - g.startY;
    if (Math.hypot(ddx, ddy) > TAP_SLOP) g.moved = true;
    if (zoomRef.current.scale > 1) {
      setZoom(clampPan({ scale: zoomRef.current.scale, x: g.panX + ddx, y: g.panY + ddy }));
    } else {
      // Résistance au-delà de la première / dernière photo.
      const atEdge = (idx === 0 && ddx > 0) || (idx === count - 1 && ddx < 0);
      setDx(atEdge ? ddx / 3 : ddx);
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g.pointers.delete(e.pointerId)) return;

    if (g.pointers.size === 1) {
      // Fin d'un pincement : le doigt restant reprend le glissement sans saut.
      const [rest] = [...g.pointers.values()];
      anchor(rest.x, rest.y);
      return;
    }
    if (g.pointers.size > 0) return;

    setDragging(false);
    setDx(0);
    if (e.type === "pointercancel") return;

    const z = zoomRef.current;
    if (z.scale > 1 && z.scale < 1.05) setZoom(NO_ZOOM);

    const ddx = e.clientX - g.startX;
    if (z.scale === 1 && g.moved) {
      const threshold = (stageRef.current?.clientWidth ?? window.innerWidth) * SWIPE_RATIO;
      if (ddx < -threshold) step(1);
      else if (ddx > threshold) step(-1);
      return;
    }

    const now = Date.now();
    if (!g.moved && now - g.startT < DOUBLE_TAP_MS) {
      if (now - g.lastTap < DOUBLE_TAP_MS) {
        g.lastTap = 0;
        if (z.scale > 1) {
          setZoom(NO_ZOOM);
        } else {
          // Zoom centré sur le point tapé : il reste sous le doigt.
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - (rect.left + rect.width / 2);
          const py = e.clientY - (rect.top + rect.height / 2);
          setZoom(
            clampPan({
              scale: DOUBLE_TAP_ZOOM,
              x: px * (1 - DOUBLE_TAP_ZOOM),
              y: py * (1 - DOUBLE_TAP_ZOOM),
            }),
          );
        }
      } else {
        g.lastTap = now;
      }
    }
  }

  const arrowClass =
    "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-fg disabled:opacity-30 sm:flex";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visionneuse photo"
      className="fixed inset-0 z-[60] bg-black text-fg"
    >
      <div
        ref={stageRef}
        className="h-full w-full touch-none select-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-idx * 100}% + ${dx}px))`,
            transition: dragging ? "none" : "transform 250ms ease-out",
          }}
        >
          {photos.map((src, i) => (
            <div key={i} className="flex h-full w-full shrink-0 items-center justify-center">
              {/* Seules la photo courante et ses voisines sont chargées. */}
              {Math.abs(i - idx) <= 1 && (
                <img
                  src={src}
                  alt={`Photo ${i + 1} sur ${count}`}
                  draggable={false}
                  className="max-h-full max-w-full object-contain"
                  style={
                    i === idx
                      ? {
                          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                          transition: dragging ? "none" : "transform 200ms ease-out",
                        }
                      : undefined
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="text-sm font-medium tabular-nums">
          {count > 1 && `${idx + 1} / ${count}`}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50"
        >
          <Icon name="close" className="text-2xl" />
        </button>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={idx === 0}
            aria-label="Photo précédente"
            className={`${arrowClass} left-3`}
          >
            <Icon name="chevron_left" className="text-3xl" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={idx === count - 1}
            aria-label="Photo suivante"
            className={`${arrowClass} right-3`}
          >
            <Icon name="chevron_right" className="text-3xl" />
          </button>
        </>
      )}
    </div>
  );
}
