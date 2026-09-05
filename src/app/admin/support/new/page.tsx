import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import NewCaseForm from "./form";

export default async function NewSupportCasePage() {
  // Any active staff member can log a case on a member's behalf — no member-
  // facing "open a case" flow exists yet (see the migration's file-header
  // comment).
  await requireStaff();

  return (
    <div>
      <Link href="/admin/support" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All support cases
      </Link>
      <h1 className="font-display font-bold text-2xl mb-1">New support case</h1>
      <p className="text-ink-500 mb-6">
        For a help request that came in outside the app (a call, an email) — never a copy of message or payment
        content. Link to the relevant order, listing, tee-time, or report instead of duplicating its data.
      </p>
      <NewCaseForm />
    </div>
  );
}
