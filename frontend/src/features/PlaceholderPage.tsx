import { Icon } from "@/shared/Icon";

export function PlaceholderPage({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-fg-muted">
      <Icon name={icon} className="text-5xl" />
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm">Bientôt disponible.</p>
    </div>
  );
}
