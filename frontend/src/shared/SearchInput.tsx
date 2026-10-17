import type { InputHTMLAttributes } from "react";
import { Icon } from "./Icon";

interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

/** Champ de recherche de l'app : loupe à gauche, même gabarit partout. */
export function SearchInput({
  value,
  onChange,
  className = "",
  ...rest
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-fg-muted"
      />
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
