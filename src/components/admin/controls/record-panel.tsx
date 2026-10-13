import type { ReactNode } from "react";
import type { StaffRecord } from "@/lib/admin/roles";
import { ENTITY_CONTROLS, canEdit, rowActionProps, type ControlEntity, type RowState } from "@/lib/admin/controls";
import AdminRowActions from "./row-actions";
import EditRecordForm from "./edit-record-form";

/**
 * The controls block on a detail page: the same actions as the list's "…"
 * menu, as buttons, with a line on the current hidden/removed state; and,
 * for records with a generic edit, the edit form (anchored at #edit, which is
 * where the list's "Edit" goes).
 */
export default function RecordPanel({
  staff,
  entity,
  id,
  state,
  title,
  values,
  stateNote,
  editIntro,
}: {
  staff: StaffRecord;
  entity: ControlEntity;
  id: string | number;
  state: RowState;
  title?: string | null;
  /** Current values for the generic edit form. Omit when this page has its own edit form. */
  values?: Record<string, unknown>;
  /** e.g. "Hidden 3 Oct by a moderator — “spam”". */
  stateNote?: ReactNode;
  editIntro?: ReactNode;
}) {
  const props = rowActionProps(staff, entity, id, state, title, { view: false });
  const fields = ENTITY_CONTROLS[entity].edit?.fields;
  const showEdit = !!values && !!fields && canEdit(staff, entity);

  return (
    <div className="grid gap-4">
      <section className="bg-surface border border-line rounded-2xl p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-3">Actions</h2>
        {stateNote && <p className="text-sm text-ink-900 bg-cream-100 rounded-lg px-3 py-2 mb-3">{stateNote}</p>}
        <AdminRowActions
          {...props}
          editHref={showEdit ? null : props.editHref}
          variant="buttons"
          // A member's "delete" starts account deletion; the page stays.
          redirectAfterDelete={entity === "user" ? null : ENTITY_CONTROLS[entity].listHref}
        />
      </section>

      {showEdit && (
        <section id="edit" className="bg-surface border border-line rounded-2xl p-5 scroll-mt-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-3">Edit</h2>
          {editIntro && <p className="text-sm text-ink-500 mb-3">{editIntro}</p>}
          <EditRecordForm entity={entity} id={id} fields={fields} values={values} />
        </section>
      )}
    </div>
  );
}
