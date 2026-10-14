/**
 * Where two-step sign-in returns a staff member to: the admin page that sent
 * them there (remembered in the pp_admin_next cookie by src/proxy.ts), if it
 * really is one. Anything else — another site, a protocol-relative URL, an
 * odd character — falls back to the Overview.
 */
export function adminReturnPath(value: string): string {
  const ok =
    value.length < 300 &&
    (value === "/admin" || value.startsWith("/admin/") || value.startsWith("/admin?")) &&
    !value.includes("//") &&
    !value.includes("\\") &&
    /^[A-Za-z0-9/_\-?=&%.[\]]+$/.test(value);
  return ok ? value : "/admin";
}
