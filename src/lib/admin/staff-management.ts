// Pure, framework-free governance rules for /admin/staff — no Supabase, no
// Next.js — mirrors support-cases.ts/roles.ts so the two rules that actually
// protect against locking every super_admin out of the console are trivial
// to unit test in isolation, independent of the database or a request.
//
// Two distinct protections, both required by the task, both enforced on
// every mutation in src/app/admin/staff/actions.ts — never just one or the
// other:
//
// 1. No super_admin may ever change their OWN staff_roles row (role or
//    status) through this UI. This is deliberately a flat rule, not a
//    "would this leave zero active super_admins" check on the actor
//    specifically — it removes the accidental-self-lockout failure mode by
//    construction (there's no path left to reason about "was this a
//    mistake") rather than trying to detect it after the fact. A second
//    super_admin must always be the one to make the change.
// 2. No change to ANYONE's row may leave zero *active* super_admins in the
//    whole table — see wouldRemoveLastActiveSuperAdmin() below. This is the
//    rule that catches every other path to the same bad state (disabling
//    the last one, demoting the last one, a second super_admin acting on a
//    colleague), not just the self-action path rule 1 already blocks.

import type { StaffRole, StaffStatus } from "./roles";

export type StaffMemberRow = {
  user_id: string;
  role: StaffRole;
  status: StaffStatus;
};

/** Rule 1 above. Checked first, before touching the database at all — a
 * self-targeted request is refused outright regardless of what the
 * requested change actually is. */
export function isSelfTargeted(actorUserId: string, targetUserId: string): boolean {
  return actorUserId === targetUserId;
}

/**
 * Rule 2 above. Given every current staff row and the row about to change,
 * returns whether applying `next` would leave the table with zero active
 * super_admins. `next` describes the row's role/status *after* the pending
 * change — pass the full intended next state, not a diff.
 *
 * Pure over its inputs so it never needs a live database to test: the
 * caller (an actions.ts Server Action) is responsible for passing in a
 * fresh, current read of every staff row immediately before applying the
 * change — never a cached or stale list, since another admin's own change
 * could have happened moments earlier.
 *
 * Safe (and cheap) to call unconditionally from every mutation, including
 * grant and reinstate: a brand-new grant's targetUserId won't match any
 * existing row, so `next` is simply never substituted in and the check
 * degenerates to "are there still active super_admins today" — a grant or
 * reinstate can only add to that count, never remove from it, so this can
 * never block one.
 */
export function wouldRemoveLastActiveSuperAdmin(
  allStaff: readonly StaffMemberRow[],
  targetUserId: string,
  next: { role: StaffRole; status: StaffStatus }
): boolean {
  const activeSuperAdminsAfterChange = allStaff.filter((row) => {
    const effective = row.user_id === targetUserId ? next : row;
    return effective.role === "super_admin" && effective.status === "active";
  });
  return activeSuperAdminsAfterChange.length === 0;
}
