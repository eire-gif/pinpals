import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/admin/format";
import { ENTITY_CONTROLS, isControlEntity, type ControlEntity, type RowState } from "@/lib/admin/controls";
import { GROUP_KIND_LABELS, OUTING_KIND_LABELS } from "@/lib/admin/admin-lists";
import AdminPageHeader from "@/components/admin/page-header";
import RecordPanel from "@/components/admin/controls/record-panel";

export const dynamic = "force-dynamic";

/**
 * One record's admin page, for the kinds that have no page of their own:
 * events, posts, comments, course reviews, marketplace reviews and pro
 * shops. What it is, its current state, the same actions as its list's "…"
 * menu, and the edit form. Users, listings, tee times, courses, groups and
 * news articles keep their own detail pages.
 */
const SUPPORTED: readonly ControlEntity[] = ["outing", "post", "post_comment", "course_review", "review", "store"];

type Person = { id: string; first_name: string | null; last_name: string | null } | null;
const nameOf = (p: Person) => [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Former member";
const personLink = (p: Person) => (p ? <Link href={`/admin/users/${p.id}`} className="underline">{nameOf(p)}</Link> : "Former member");

type Loaded = {
  title: string;
  confirmTitle: string | null;
  facts: [string, ReactNode][];
  body?: string | null;
  state: RowState;
  values: Record<string, unknown>;
  stateNote: string | null;
  back: { href: string; label: string };
};

function hiddenNote(hiddenAt: string | null, reason: string | null, who: string): string | null {
  if (!hiddenAt) return null;
  return `Hidden ${formatDateTime(hiddenAt)}${reason ? ` — “${reason}”` : ""}. ${who}`;
}

async function load(entity: ControlEntity, id: number): Promise<Loaded | null> {
  const admin = createAdminClient();
  switch (entity) {
    case "outing": {
      const { data: o } = await admin
        .from("society_outings")
        .select("*, groups ( id, name, kind ), society_outing_entries ( count )")
        .eq("id", id)
        .maybeSingle();
      if (!o) return null;
      const group = o.groups as { id: number; name: string; kind: string } | null;
      return {
        title: o.title,
        confirmTitle: o.title,
        facts: [
          ["Group", group ? <Link href={`/admin/groups/${group.id}`} className="underline">{group.name}</Link> : "—"],
          ["Kind", `${OUTING_KIND_LABELS[o.kind ?? "day"] ?? "Event"}${group ? ` · ${GROUP_KIND_LABELS[group.kind] ?? group.kind}` : ""}`],
          ["Date", o.ends_on ? `${o.plays_on} to ${o.ends_on}` : o.plays_on],
          ["Where", o.course_name ?? o.location ?? "—"],
          ["Entries", String((o.society_outing_entries as { count: number }[] | null)?.[0]?.count ?? 0)],
          ["Entry fee", o.entry_fee_cents != null ? `€${(o.entry_fee_cents / 100).toFixed(2)}` : "—"],
          ["Status", o.status === "cancelled" ? "Cancelled" : "Open"],
        ],
        body: o.details,
        state: { hidden: !!o.hidden_at, removed: o.status === "cancelled" },
        values: { title: o.title, details: o.details },
        stateNote: hiddenNote(o.hidden_at, o.hidden_reason, "The group's members can't see it."),
        back: { href: "/admin/groups/events", label: "All events" },
      };
    }
    case "post": {
      const { data: p } = await admin
        .from("posts")
        .select("id, body, visibility, kind, like_count, comment_count, hidden_at, hidden_reason, created_at, author:profiles!posts_author_id_fkey ( id, first_name, last_name )")
        .eq("id", id)
        .maybeSingle();
      if (!p) return null;
      const author = p.author as unknown as Person;
      return {
        title: `Post #${p.id}`,
        confirmTitle: null,
        facts: [
          ["Author", personLink(author)],
          ["Posted", formatDateTime(p.created_at)],
          ["Seen by", p.visibility === "members" ? "All members" : "Connections only"],
          ["Kind", p.kind],
          ["Likes · comments", `${p.like_count} · ${p.comment_count}`],
          ["In the feed list", <Link key="f" href={`/admin/feed?postId=${p.id}`} className="underline">Open with its comments</Link>],
        ],
        body: p.body,
        state: { hidden: !!p.hidden_at },
        values: { body: p.body },
        stateNote: hiddenNote(p.hidden_at, p.hidden_reason, "Only its author can see it."),
        back: { href: "/admin/feed", label: "Social" },
      };
    }
    case "post_comment": {
      const { data: c } = await admin
        .from("post_comments")
        .select("id, post_id, body, hidden_at, hidden_reason, created_at, author:profiles!post_comments_author_id_fkey ( id, first_name, last_name )")
        .eq("id", id)
        .maybeSingle();
      if (!c) return null;
      return {
        title: `Comment #${c.id}`,
        confirmTitle: null,
        facts: [
          ["Author", personLink(c.author as unknown as Person)],
          ["Posted", formatDateTime(c.created_at)],
          ["On", <Link key="p" href={`/admin/feed?commentId=${c.id}`} className="underline">Post #{c.post_id}</Link>],
        ],
        body: c.body,
        state: { hidden: !!c.hidden_at },
        values: { body: c.body },
        stateNote: hiddenNote(c.hidden_at, c.hidden_reason, "Only its author can see it."),
        back: { href: `/admin/feed?postId=${c.post_id}`, label: "Its post" },
      };
    }
    case "course_review": {
      const { data: r } = await admin
        .from("course_reviews")
        .select("id, rating, body, created_at, hidden_at, hidden_reason, club:clubs ( id, name ), member:profiles!course_reviews_member_id_fkey ( id, first_name, last_name )")
        .eq("id", id)
        .maybeSingle();
      if (!r) return null;
      const club = r.club as unknown as { id: number; name: string } | null;
      return {
        title: `Course review #${r.id}`,
        confirmTitle: null,
        facts: [
          ["Course", club ? <Link href={`/admin/clubs/${club.id}`} className="underline">{club.name}</Link> : "—"],
          ["Member", personLink(r.member as unknown as Person)],
          ["Rating", `${r.rating}★`],
          ["Written", formatDateTime(r.created_at)],
        ],
        body: r.body,
        state: { hidden: !!r.hidden_at },
        values: { rating: r.rating, body: r.body },
        stateNote: hiddenNote(r.hidden_at, r.hidden_reason, "It's out of the course's average too."),
        back: { href: "/admin/course-reviews", label: "Course reviews" },
      };
    }
    case "review": {
      const { data: r } = await admin
        .from("reviews")
        .select("id, order_id, reviewer_id, reviewee_id, rating, body, created_at, hidden_at, hidden_reason")
        .eq("id", id)
        .maybeSingle();
      if (!r) return null;
      const { data: people } = await admin.from("profiles").select("id, first_name, last_name").in("id", [r.reviewer_id, r.reviewee_id]);
      const byId = new Map((people ?? []).map((p) => [p.id, p as Person]));
      return {
        title: `Review #${r.id}`,
        confirmTitle: null,
        facts: [
          ["From", personLink(byId.get(r.reviewer_id) ?? null)],
          ["About", personLink(byId.get(r.reviewee_id) ?? null)],
          ["Order", <Link key="o" href={`/admin/orders/${r.order_id}`} className="underline">#{r.order_id}</Link>],
          ["Rating", `${r.rating}★`],
          ["Written", formatDateTime(r.created_at)],
        ],
        body: r.body,
        state: { hidden: !!r.hidden_at },
        values: { rating: r.rating, body: r.body },
        stateNote: hiddenNote(r.hidden_at, r.hidden_reason, "It's out of the seller's rating too."),
        back: { href: "/admin/reviews", label: "Reviews" },
      };
    }
    case "store": {
      const { data: s } = await admin
        .from("stores")
        .select("id, slug, name, description, status, commission_rate, created_at, approved_at, owner:profiles!stores_owner_id_fkey ( id, first_name, last_name ), club:clubs ( id, name )")
        .eq("id", id)
        .maybeSingle();
      if (!s) return null;
      const club = s.club as unknown as { id: number; name: string } | null;
      return {
        title: s.name,
        confirmTitle: s.name,
        facts: [
          ["Owner", personLink(s.owner as unknown as Person)],
          ["Club", club ? <Link href={`/admin/clubs/${club.id}`} className="underline">{club.name}</Link> : "—"],
          ["Status", s.status === "suspended" ? "Suspended" : s.status === "pending" ? "Waiting for approval" : "Live"],
          ["Commission", s.commission_rate != null ? `${(Number(s.commission_rate) * 100).toFixed(1)}%` : "Standard"],
          ["Opened", formatDateTime(s.created_at)],
          ["Approve, commission", <Link key="m" href="/admin/marketplace?tab=shops" className="underline">Pro shops tab</Link>],
        ],
        body: s.description,
        state: { hidden: s.status === "suspended" },
        values: { name: s.name, description: s.description },
        stateNote: s.status === "suspended" ? "Suspended — the shop is hidden and can't add stock." : null,
        back: { href: "/admin/marketplace?tab=shops", label: "Pro shops" },
      };
    }
    default:
      return null;
  }
}

export default async function AdminRecordPage({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const { staff } = await requireStaff();
  const { entity, id } = await params;
  if (!isControlEntity(entity) || !SUPPORTED.includes(entity)) notFound();
  const recordId = Number.parseInt(id, 10);
  if (!Number.isFinite(recordId) || recordId <= 0) notFound();

  const record = await load(entity, recordId);
  if (!record) notFound();

  const c = ENTITY_CONTROLS[entity];

  return (
    <div>
      <AdminPageHeader
        eyebrow={<Link href={record.back.href}>← {record.back.label}</Link>}
        title={record.title}
        description={`${c.noun[0].toUpperCase()}${c.noun.slice(1)} #${recordId}`}
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <section className="bg-surface border border-line rounded-2xl p-5 min-w-0">
          <dl className="grid sm:grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-sm">
            {record.facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-500">{label}</dt>
                <dd className="text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
          {record.body && <p className="text-sm whitespace-pre-wrap mt-4 pt-4 border-t border-line">{record.body}</p>}
        </section>

        <RecordPanel
          staff={staff}
          entity={entity}
          id={recordId}
          state={record.state}
          title={record.confirmTitle}
          values={record.values}
          stateNote={record.stateNote}
        />
      </div>
    </div>
  );
}
