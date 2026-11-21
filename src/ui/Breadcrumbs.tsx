import { Icon } from "./Icon";

interface BreadcrumbItem {
  id: string;
  label: string;
  onClick: () => void;
}

export function Breadcrumbs({ label, items }: { label: string; items: readonly BreadcrumbItem[] }) {
  return (
    <nav className="workspace-breadcrumbs" aria-label={label}>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            {index > 0 ? <Icon name="chevron-right" width="12" height="12" /> : null}
            <button
              type="button"
              title={item.label}
              aria-current={index === items.length - 1 ? "location" : undefined}
              onClick={item.onClick}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
