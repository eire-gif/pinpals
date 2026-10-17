import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  ACTIVITY_RANGES,
  ACTIVITY_RANGE_LABELS,
  LIVE_PANEL_ROLES,
  activityHref,
  activityWindow,
  formatLabel,
  parseActivityKind,
  parseActivityRange,
  toParText,
  type ActivityKind,
  type ActivityRange,
} from "@/lib/admin/live-panel";
import { listActivity, type GameRow, type ScorecardRow, type SimpleRow } from "@/lib/admin/activity-lists";
import AdminPageHeader from "@/components/admin/page-header";
import { AdminTable, EmptyState, Pill, Td, Th, Tr } from "@/components/admin/table";

export const dynamic = "force-dynamic";

/**
 * Activity — what's behind each number on the Overview's "Live now" panel:
 * today's scorecards, games, tee times, groups, new members, listings and
 * posts, each row opening its own page. Super admin only, like the panel.
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; range?: string }>;
}) {
  await requireStaff({ roles: LIVE_PANEL_ROLES });
  const sp = await searchParams;
  const kind = parseActivityKind(sp.show);
  const range = parseActivityRange(sp.range);
  const window = activityWindow(range, new Date());

  let list: Awaited<ReturnType<typeof listActivity>> | null = null;
  try {
    list = await listActivity(kind, window);
  } catch (e) {
    console.error("admin activity list failed", e);
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="hover:underline">
            ← Overview
          </Link>
        }
        title="Activity"
        description={`${ACTIVITY_KIND_LABELS[kind]} · ${ACTIVITY_RANGE_LABELS[range].toLowerCase()}${
          list ? ` · ${list.rows.length.toLocaleString("en-IE")}${list.rows.length >= 200 ? " (latest 200)" : ""}` : ""
        }`}
      />

      <nav aria-label="What to show" className="flex flex-wrap gap-1.5 mb-3">
        {ACTIVITY_KINDS.map((k) => (
          <PillLink key={k} href={activityHref(k, range)} active={k === kind}>
            {ACTIVITY_KIND_LABELS[k]}
          </PillLink>
        ))}
      </nav>
      <nav aria-label="When" className="flex flex-wrap gap-1.5 mb-5">
        {ACTIVITY_RANGES.map((r) => (
          <PillLink key={r} href={activityHref(kind, r)} active={r === range} small>
            {ACTIVITY_RANGE_LABELS[r]}
          </PillLink>
        ))}
      </nav>

      {!list ? (
        <AdminTable empty={<EmptyState title="Couldn't load this list." hint="Refresh to try again." />}>{null}</AdminTable>
      ) : list.kind === "scorecards" ? (
        <ScorecardsTable rows={list.rows} range={range} />
      ) : list.kind === "games" ? (
        <GamesTable rows={list.rows} range={range} />
      ) : (
        <SimpleTable kind={list.kind} rows={list.rows} range={range} />
      )}
    </div>
  );
}

function PillLink({ href, active, small, children }: { href: string; active: boolean; small?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${small ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm"} rounded-full font-semibold border transition ${
        active ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line text-ink-900 hover:bg-cream-100"
      }`}
    >
      {children}
    </Link>
  );
}

function when(iso: string, range: ActivityRange): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
  if (range === "7d") {
    return `${d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" })}, ${time}`;
  }
  return time;
}

function empty(kind: ActivityKind, range: ActivityRange) {
  return (
    <AdminTable
      empty={
        <EmptyState
          title={`No ${ACTIVITY_KIND_LABELS[kind].toLowerCase()} ${range === "7d" ? "in the last 7 days" : range}.`}
          hint={range === "today" ? <Link href={activityHref(kind, "7d")} className="text-green-700 font-semibold hover:underline">See the last 7 days</Link> : undefined}
        />
      }
    >
      {null}
    </AdminTable>
  );
}

function ScorecardsTable({ rows, range }: { rows: ScorecardRow[]; range: ActivityRange }) {
  if (!rows.length) return empty("scorecards", range);
  return (
    <AdminTable>
      <thead>
        <tr>
          <Th>Saved</Th>
          <Th>Golfer</Th>
          <Th>Course</Th>
          <Th className="text-right">Score</Th>
          <Th>Holes</Th>
          <Th>Certified</Th>
          <Th>From</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <Tr key={c.id}>
            <Td className="whitespace-nowrap text-ink-500">{when(c.created_at, range)}</Td>
            <Td>
              <Link href={`/admin/scorecards/${c.id}`} className="font-semibold text-ink-900 hover:underline">
                {c.member?.name ?? "Former member"}
              </Link>
            </Td>
            <Td>
              <Link href={`/admin/scorecards/${c.id}`} className="hover:underline">
                {c.course_name}
              </Link>
              {c.tee_name && <span className="text-ink-500"> · {c.tee_name}</span>}
              {c.team_card && <span className="text-ink-500"> · {formatLabel(c.team_card)}</span>}
            </Td>
            <Td className="text-right whitespace-nowrap tabular-nums">
              {c.played ? (
                <>
                  <span className="font-bold text-ink-900">{c.gross}</span> <span className="text-ink-500">({toParText(c.toPar)})</span>
                </>
              ) : (
                <span className="text-ink-500">—</span>
              )}
            </Td>
            <Td>{c.complete ? <Pill tone="good">All {c.holes}</Pill> : <Pill tone="warn">{c.played} of {c.holes}</Pill>}</Td>
            <Td>{c.certified_by ? <Pill tone="good">✓ {c.certified_by}</Pill> : <span className="text-ink-500 text-xs">Not certified</span>}</Td>
            <Td className="text-ink-500 text-xs whitespace-nowrap">
              {c.source === "live" ? "Live scoring" : "Entered by hand"}
              {c.visibility === "private" && " · private"}
            </Td>
          </Tr>
        ))}
      </tbody>
    </AdminTable>
  );
}

function GamesTable({ rows, range }: { rows: GameRow[]; range: ActivityRange }) {
  if (!rows.length) return empty("games", range);
  return (
    <AdminTable>
      <thead>
        <tr>
          <Th>Started</Th>
          <Th>Course</Th>
          <Th>Format</Th>
          <Th>Players</Th>
          <Th>Progress</Th>
          <Th>Scorecards</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <Tr key={g.id}>
            <Td className="whitespace-nowrap text-ink-500">{when(g.created_at, range)}</Td>
            <Td className="font-semibold text-ink-900">{g.course_name}</Td>
            <Td>{formatLabel(g.format)}</Td>
            <Td className="text-sm">{g.players.join(", ") || "—"}</Td>
            <Td>
              {g.status === "finished" ? (
                <Pill tone="good">Finished</Pill>
              ) : (
                <Pill tone="info">{g.thru ? `Live · thru ${g.thru}` : "Live · on the 1st"}</Pill>
              )}
            </Td>
            <Td>
              {g.scorecard_ids.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {g.scorecard_ids.map((id, i) => (
                    <Link key={id} href={`/admin/scorecards/${id}`} className="text-green-700 font-semibold hover:underline text-sm">
                      Card {i + 1}
                    </Link>
                  ))}
                </span>
              ) : (
                <span className="text-ink-500 text-xs">None saved yet</span>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </AdminTable>
  );
}

const WHO_HEADING: Partial<Record<ActivityKind, string>> = {
  tee_times: "Host",
  groups: "Started by",
  listings: "Seller",
  posts: "Author",
};

const STATUS_TONE: Record<string, "good" | "bad" | "warn" | "neutral"> = {
  open: "good",
  active: "good",
  full: "neutral",
  sold: "neutral",
  cancelled: "bad",
  removed: "bad",
  hidden: "bad",
  deleted: "bad",
  pending_review: "warn",
  expired: "neutral",
};

function SimpleTable({ kind, rows, range }: { kind: ActivityKind; rows: SimpleRow[]; range: ActivityRange }) {
  if (!rows.length) return empty(kind, range);
  const whoHeading = WHO_HEADING[kind];
  return (
    <AdminTable>
      <thead>
        <tr>
          <Th>{kind === "members" ? "Joined" : "Posted"}</Th>
          <Th>{kind === "members" ? "Member" : kind === "posts" ? "Post" : kind === "groups" ? "Group" : kind === "listings" ? "Listing" : "Tee time"}</Th>
          {whoHeading && <Th>{whoHeading}</Th>}
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={String(r.id)}>
            <Td className="whitespace-nowrap text-ink-500">{when(r.at, range)}</Td>
            <Td>
              <Link href={r.href} className="font-semibold text-ink-900 hover:underline">
                {r.title}
              </Link>
              {r.sub && <div className="text-xs text-ink-500 mt-0.5">{r.sub}</div>}
            </Td>
            {whoHeading && (
              <Td>
                {r.who ? (
                  <Link href={`/admin/users/${r.who.id}`} className="hover:underline">
                    {r.who.name}
                  </Link>
                ) : (
                  <span className="text-ink-500">—</span>
                )}
              </Td>
            )}
            <Td>{r.status ? <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Pill> : <span className="text-ink-500">—</span>}</Td>
          </Tr>
        ))}
      </tbody>
    </AdminTable>
  );
}
