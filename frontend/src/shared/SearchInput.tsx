import type { InputHTMLAttributes } from "react";
import { Icon } from "./Icon";

interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Icône de gauche (loupe par défaut). */
  icon?: string;
  /** Rend l'icône cliquable (ex. bascule de mode de recherche). */
  onIconClick?: () => void;
  iconLabel?: string;
}

/** Champ de recherche de l'app : loupe à gauche, même gabarit partout. */
export function SearchInput({
  value,
  onChange,
  icon = "search",
  onIconClick,
  iconLabel,
  className = "",
  ...rest
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      {onIconClick ? (
        <button
          type="button"
          onClick={onIconClick}
          aria-label={iconLabel}
          title={iconLabel}
          className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-fg hover:bg-bg-elev"
        >
          <Icon name={icon} className="text-xl" />
        </button>
      ) : (
        <Icon
          name={icon}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
        />
      )}
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-bg-soft pl-10 pr-3 text-sm outline-none focus:border-fg"
        {...rest}
      />
    </div>
  );
}
