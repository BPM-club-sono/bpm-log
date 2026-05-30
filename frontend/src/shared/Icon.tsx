interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
}

/** Icône Google Material Symbols (Outlined). */
export function Icon({ name, className = "", filled = false }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      aria-hidden
    >
      {name}
    </span>
  );
}
