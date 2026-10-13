import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { EDIT_ROLES } from "@/lib/admin/controls";
import AdminPageHeader from "@/components/admin/page-header";
import EditClubForm, { EMPTY_CLUB } from "../[id]/edit-club-form";

export const dynamic = "force-dynamic";

/** Add a course by hand — one OpenStreetMap doesn't know about. */
export default async function NewClubPage() {
  await requireStaff({ roles: EDIT_ROLES });

  return (
    <div className="max-w-2xl">
      <AdminPageHeader
        eyebrow={<Link href="/admin/clubs">← All courses</Link>}
        title="Add course"
        description="For a course the import doesn't have. Its web address is made from the name."
      />
      <div className="bg-surface border border-line rounded-2xl p-6">
        <EditClubForm club={EMPTY_CLUB} mode="create" />
      </div>
    </div>
  );
}
