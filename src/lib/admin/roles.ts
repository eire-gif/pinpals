// Pure, framework-free admin role/permission model. No Supabase, no Next.js —
// kept this way so the access-control logic itself is trivial to unit test
// without mocking a database or a request. `authorization.ts` is the layer
// that wires this up to a real session; every page and server mutation should
// go through that, not reimplement the check inline.

export const STAFF_ROLES = ["support", "moderator", "finance", "admin", "super_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_STATUSES = ["active", "disabled"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  support: "Support",
  moderator: "Moderator",
  finance: "Finance",
  admin: "Admin",
  super_admin: "Super Admin",
};

export type StaffRecord = {
  user_id: string;
  role: StaffRole;
  status: StaffStatus;
};

/**
 * Whether a staff record is allowed access, optionally restricted to a set of
 * roles. A `null` record (not staff at all) or a `disabled` record is always
 * denied, regardless of role. An empty/omitted `allowedRoles` means "any
 * active staff role is enough."
 */
export function canAccess(
  staff: Pick<StaffRecord, "role" | "status"> | null,
  allowedRoles?: readonly StaffRole[]
): boolean {
  if (!staff) return false;
  if (staff.status !== "active") return false;
  if (!allowedRoles || allowedRoles.length === 0) return true;
  return allowedRoles.includes(staff.role);
}
