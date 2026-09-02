// Shared shape for every admin moderation Server Action's useActionState
// result (src/app/admin/*/[id]/actions.ts). Kept in one place so the client
// form component (src/components/admin/moderation-form.tsx) can be generic
// over any of them, and so the six actions don't each redeclare an identical
// type.
export type ModerationState = { error?: string; success?: boolean };

// Every moderation action in this slice is gated to the same set of roles:
// `support` is read-only per the role model in admin-architecture-review.md
// §6 ("support — ... no destructive actions"), and `finance` has no reason to
// suspend a user or take down a listing/invite. Exported so each actions.ts
// file (and its tests) use the exact same list rather than three copies that
// could drift.
export const MODERATION_ROLES = ["moderator", "admin", "super_admin"] as const;
