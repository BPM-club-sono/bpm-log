import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";

const tabs = [
  { to: "/", icon: "home", label: "Accueil" },
  { to: "/scan", icon: "qr_code_scanner", label: "Scan" },
  { to: "/inventaire", icon: "inventory_2", label: "Parc" },
  { to: "/profil", icon: "person", label: "Profil" },
];

export function TabBar() {
  return (
    <nav className="border-t border-line bg-bg-soft">
      <ul className="mx-auto flex max-w-md">
        {tabs.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  isActive ? "text-fg" : "text-fg-muted"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={t.icon} filled={isActive} className="text-2xl" />
                  {t.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
