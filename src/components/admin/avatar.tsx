import { initials } from "@/lib/format";

// Small, medium, large — table rows use sm, detail-page headers use lg.
const SIZE_CLASSES = {
  sm: "w-9 h-9 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-16 h-16 text-xl",
} as const;

export default function AdminAvatar({
  name,
  color,
  size = "sm",
}: {
  name: string;
  color: string | null;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center text-white font-display font-bold ${SIZE_CLASSES[size]}`}
      style={{ background: color ?? "#1f5c2e" }}
    >
      {initials(name)}
    </div>
  );
}
