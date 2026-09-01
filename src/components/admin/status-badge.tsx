import { statusLabel, statusStyle } from "@/lib/admin/format";

export default function StatusBadge({
  status,
  labels,
  styles,
}: {
  status: string;
  labels: Record<string, string>;
  styles: Record<string, string>;
}) {
  return (
    <span
      className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${statusStyle(styles, status)}`}
    >
      {statusLabel(labels, status)}
    </span>
  );
}
