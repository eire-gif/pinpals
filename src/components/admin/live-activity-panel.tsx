"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { LiveStats } from "@/lib/admin/live-stats";
import { FEED_LABELS, ago, activityHref, changeVsYesterday, formatLabel, type ActivityKind } from "@/lib/admin/live-panel";
import { ACTIVITY_SECTIONS, SECTION_LABELS, type ActivitySection } from "@/lib/activity";

/**
 * The super admin's "Live now" panel on the Overview (0161). Rendered with
 * the numbers already in it (no empty flash on sign-in), then refreshed from
 * /admin/live-stats every 15 seconds while the tab is visible.
 */
const REFRESH_MS = 15_000;

export default function LiveActivityPanel({ initial }: { initial: LiveStats | null }) {
  const [stats, setStats] = useState<LiveStats | null>(initial);
  const [failed, setFailed] = useState(initial == null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/admin/live-stats", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      setStats((await res.json()) as LiveStats);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    const back = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", back);
    };
  }, [refresh]);

  return (
    <section className="mb-10" aria-labelledby="live-now-title">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <h2 id="live-now-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            {!failed && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-60" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${failed ? "bg-ink-500" : "bg-green-600"}`} />
          </span>
          Live now
        </h2>
        <p className="text-xs text-ink-500" aria-live="polite">
          {failed
            ? "Couldn't refresh — showing the last numbers. Trying again…"
            : stats
              ? `Updated ${ago(stats.generated_at, now)} · refreshes every 15 seconds`
              : ""}
          {" "}
          <button type="button" onClick={() => void refresh()} className="ml-1 font-semibold text-green-700 hover:underline">
            Refresh
          </button>
        </p>
      </div>

      {!stats ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          Live numbers aren&rsquo;t available right now.
        </div>
      ) : (
        <LiveBody stats={stats} now={now} />
      )}
    </section>
  );
}

function LiveBody({ stats, now }: { stats: LiveStats; now: number }) {
  const n = stats.now;
  const t = stats.today;
  const y = stats.yesterday;

  return (
    <div className="space-y-4">
      {/* Right now */}
      <div className="rounded-2xl bg-navy-900 p-4 sm:p-5 text-cream-50 shadow-sm">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:divide-x lg:divide-navy-800">
          <Hero label="Online now" value={n.online} sub={`${n.members_online} members · ${n.guests_online} visitors`}>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <Chip>Web {n.web}</Chip>
              <Chip>iPhone {n.ios}</Chip>
              <Chip>Android {n.android}</Chip>
            </div>
          </Hero>
          <Hero label="Games in play" value={n.games_in_play} sub={`${n.players_on_course} ${n.players_on_course === 1 ? "player" : "players"} on the course`} />
          <Hero label="Scores entered" value={n.scores_last_10_min} sub="In the last 10 minutes" />
          <Link href={activityHref("games")} className="block rounded-xl hover:bg-navy-800/60 transition -m-1 p-1">
            <Hero label="Games today ›" value={t.games_started} sub={`${t.games_finished} finished · ${t.scores_entered} scores`} />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GamesCard games={stats.games} now={now} />
        <SectionsCard online={n.by_section} views={stats.views_by_section} />
      </div>

      {/* Today so far */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-ink-500">
            Today so far <span className="font-normal">· since midnight · tap a number to see them</span>
          </h3>
          <Link href={activityHref("scorecards")} className="text-xs font-semibold text-green-700 hover:underline shrink-0">
            All activity →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Visitors" value={t.visitors} prev={y.visitors} sub={`${t.members_active} signed-in members`} />
          <Tile label="Page & screen views" value={t.views} prev={y.views} sub={`${t.web_views} web · ${t.app_views} app`} />
          <Tile label="App opens" value={t.app_opens} />
          <Tile label="New members" value={t.new_members} prev={y.new_members} href={activityHref("members")} />
          <Tile label="Games started" value={t.games_started} prev={y.games_started} href={activityHref("games")} />
          <Tile
            label="Scorecards completed"
            value={t.scorecards_saved}
            sub={`${t.games_finished} ${t.games_finished === 1 ? "game" : "games"} finished`}
            href={activityHref("scorecards")}
          />
          <Tile label="Tee times posted" value={t.tee_times_posted} prev={y.tee_times_posted} href={activityHref("tee_times")} />
          <Tile label="Tee time requests" value={t.tee_time_requests} href={activityHref("tee_times")} />
          <Tile label="Listings posted" value={t.listings_posted} prev={y.listings_posted} href={activityHref("listings")} />
          <Tile label="Messages sent" value={t.messages_sent} prev={y.messages_sent} />
          <Tile label="Social posts" value={t.posts} href={activityHref("posts")} />
          <Tile label="Groups created" value={t.groups_created} href={activityHref("groups")} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HourlyChart title="Page & screen views by hour" field="views" hourly={stats.hourly} />
        <HourlyChart title="Games started by hour" field="games" hourly={stats.hourly} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AppCard stats={stats} />
        <FeedCard feed={stats.feed} now={now} />
      </div>
    </div>
  );
}

function Hero({ label, value, sub, children }: { label: string; value: number; sub: string; children?: React.ReactNode }) {
  return (
    <div className="lg:pl-4 first:lg:pl-0">
      <div className="text-xs font-semibold text-gold-400">{label}</div>
      <div className="font-display font-bold text-4xl mt-1 tabular-nums">{value.toLocaleString("en-IE")}</div>
      <div className="text-xs text-cream-100 mt-0.5">{sub}</div>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-navy-800 bg-navy-800/60 px-2 py-0.5 text-cream-100 tabular-nums">{children}</span>;
}

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {aside && <div className="text-xs text-ink-500">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

function Tile({ label, value, prev, sub, href }: { label: string; value: number; prev?: number; sub?: string; href?: string }) {
  const change = changeVsYesterday(value, prev);
  const body = (
    <>
      <div className="flex items-start justify-between gap-1 text-xs font-semibold text-ink-500">
        <span>{label}</span>
        {href && <span aria-hidden className="text-green-700">›</span>}
      </div>
      <div className="font-display font-bold text-2xl mt-1 text-ink-900 tabular-nums">{value.toLocaleString("en-IE")}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>}
      {change && (
        <div
          className={`text-[11px] mt-0.5 font-medium ${
            change.dir === "up" ? "text-green-700" : change.dir === "down" ? "text-red-600" : "text-ink-500"
          }`}
        >
          {change.dir === "up" ? "▲ " : change.dir === "down" ? "▼ " : ""}
          {change.text}
        </div>
      )}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-2xl border border-line bg-surface p-3.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-green-700 transition"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">{body}</div>
  );
}

function GamesCard({ games, now }: { games: LiveStats["games"]; now: number }) {
  return (
    <Card
      title="Games on the course"
      aside={
        <Link href={activityHref("games")} className="font-semibold text-green-700 hover:underline">
          {games.length ? `${games.length} live · all games ›` : "All games today ›"}
        </Link>
      }
    >
      {games.length === 0 ? (
        <p className="text-sm text-ink-500 py-4">No games being played right now. A game shows here once it&rsquo;s started or scored in the last 30 minutes.</p>
      ) : (
        <ul className="divide-y divide-line">
          {games.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-900 truncate">{g.course_name}</div>
                <div className="text-xs text-ink-500">
                  {formatLabel(g.format)} · {g.players} {g.players === 1 ? "player" : "players"} · started {ago(g.started_at, now)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-green-700 tabular-nums">{g.thru === 0 ? "On the 1st" : g.thru >= g.holes ? "Finishing" : `Thru ${g.thru}`}</div>
                {g.last_score_at && <div className="text-[11px] text-ink-500">scored {ago(g.last_score_at, now)}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SectionsCard({ online, views }: { online: Record<string, number>; views: Record<string, number> }) {
  const rows = ACTIVITY_SECTIONS.map((s) => ({ key: s, online: online[s] ?? 0, views: views[s] ?? 0 }))
    .filter((r) => r.online > 0 || r.views > 0)
    .sort((a, b) => b.online - a.online || b.views - a.views);
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <Card title="Where people are" aside="Online now · views today">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 py-4">Nobody&rsquo;s been on yet today.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.key} title={`${SECTION_LABELS[r.key as ActivitySection]}: ${r.online} online now, ${r.views} views today`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-900 truncate">{SECTION_LABELS[r.key as ActivitySection]}</span>
                <span className="shrink-0 tabular-nums text-xs text-ink-500">
                  <span className={`font-bold ${r.online ? "text-green-700" : "text-ink-500"}`}>{r.online} online</span> · {r.views.toLocaleString("en-IE")} views
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-cream-100" aria-hidden>
                <div className="h-1.5 rounded-full bg-green-700" style={{ width: `${Math.max(2, (r.views / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HourlyChart({ title, field, hourly }: { title: string; field: "views" | "games"; hourly: LiveStats["hourly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = hourly ?? [];
  const max = Math.max(1, ...points.map((p) => p[field]));
  const total = points.reduce((sum, p) => sum + p[field], 0);
  const label = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
  const shown = hover != null ? points[hover] : null;
  return (
    <Card title={title} aside={shown ? `${label(shown.hour)} · ${shown[field]}` : `${total.toLocaleString("en-IE")} today`}>
      <div className="flex h-28 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`${title}: ${total} today`}>
        {points.map((p, i) => (
          <div
            key={p.hour}
            className="flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            title={`${label(p.hour)}: ${p[field]}`}
          >
            <div
              className={`w-full rounded-t-[4px] ${hover === i ? "bg-gold-500" : "bg-green-700"}`}
              style={{ height: p[field] ? `${Math.max(4, (p[field] / max) * 100)}%` : "2px", opacity: p[field] ? 1 : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-500 tabular-nums">
        <span>{points[0] ? label(points[0].hour) : ""}</span>
        <span>Now</span>
      </div>
    </Card>
  );
}

function AppCard({ stats }: { stats: LiveStats }) {
  const i = stats.installs;
  return (
    <Card title="The app" aside={`${stats.today.new_installs} new installs today`}>
      <div className="grid grid-cols-3 gap-3">
        <Mini label="Installs" value={i.total} sub={`${i.ios} iPhone · ${i.android} Android`} />
        <Mini label="Active (7 days)" value={i.active_7d} />
        <Mini label="With notifications" value={i.push_ios + i.push_android} sub={`${i.push_ios} iPhone · ${i.push_android} Android`} />
      </div>
      <p className="mt-3 text-[11px] leading-snug text-ink-500">
        Installs are phones that have opened the app since live tracking began (17 Oct 2026). Store download totals are in App Store
        Connect and Google Play Console. {stats.totals.members.toLocaleString("en-IE")} members · {stats.totals.games.toLocaleString("en-IE")} games ever ·{" "}
        {stats.totals.live_listings.toLocaleString("en-IE")} live listings.
      </p>
    </Card>
  );
}

function Mini({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-ink-500">{label}</div>
      <div className="font-display font-bold text-2xl text-ink-900 tabular-nums">{value.toLocaleString("en-IE")}</div>
      {sub && <div className="text-[11px] text-ink-500">{sub}</div>}
    </div>
  );
}

const FEED_KIND: Record<string, ActivityKind> = {
  game_started: "games",
  game_finished: "scorecards",
  new_member: "members",
  tee_time: "tee_times",
  listing: "listings",
  group: "groups",
};

/** Today's list for something from today, the last 7 days for anything older. */
function sinceToday(iso: string, now: number): "today" | "7d" {
  return now - new Date(iso).getTime() < 12 * 3600_000 && new Date(iso).toDateString() === new Date(now).toDateString() ? "today" : "7d";
}

const FEED_DOT: Record<string, string> = {
  game_started: "bg-green-600",
  game_finished: "bg-green-800",
  new_member: "bg-gold-500",
  tee_time: "bg-navy-800",
  listing: "bg-buy-600",
  group: "bg-ink-500",
};

function FeedCard({ feed, now }: { feed: LiveStats["feed"]; now: number }) {
  return (
    <Card title="Latest activity">
      {feed.length === 0 ? (
        <p className="text-sm text-ink-500 py-4">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {feed.slice(0, 10).map((f, i) => (
            <li key={`${f.kind}-${f.at}-${i}`}>
              <Link href={activityHref(FEED_KIND[f.kind] ?? "scorecards", sinceToday(f.at, now))} className="flex items-start gap-2.5 text-sm rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-surface-tint">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${FEED_DOT[f.kind] ?? "bg-ink-500"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink-900">{FEED_LABELS[f.kind] ?? f.kind}</span>
                <span className="text-ink-500"> · </span>
                <span className="text-ink-900 break-words">{f.label}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-500 tabular-nums">{ago(f.at, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
