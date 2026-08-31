export default function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M6 46c10-6 42-6 52 0" stroke="#3f9350" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="45" r="3" fill="#f4efe1" />
      <line x1="32" y1="45" x2="32" y2="12" stroke="#f4efe1" strokeWidth="2.4" />
      <path d="M32 12 L50 18 L32 24 Z" fill="#a83a2b" />
      <path d="M12 42c2-6 4-6 6-8" stroke="#f4efe1" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
      <path d="M20 42c1.5-5 3-6 5-8" stroke="#f4efe1" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
