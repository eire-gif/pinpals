import Image from "next/image";
import { notFound } from "next/navigation";

import { GROUP_KIND_INFO, isGroupInviteCode, isGroupKind } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import JoinGroupForm from "./join-group-form";

export const metadata = { title: "You're invited to a group on PinPals", robots: { index: false, follow: false } };

type Preview = {
  group_id: number;
  name: string;
  kind: string;
  about: string | null;
  member_count: number;
  club_name: string | null;
  owner_first_name: string | null;
};

/**
 * /join/g/<code> — a group's invite link, shared by whoever runs it (often a
 * society secretary, in the society's WhatsApp group). Shows the group's
 * front page only — name, kind, size, home club and who runs it — and joins
 * straight in: holding the link is the approval. With the app installed the
 * same link opens the app instead (the AASA claims /join/*).
 */
export default async function JoinGroupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toLowerCase();
  if (!isGroupInviteCode(code)) notFound();

  const supabase = await createClient();
  const [{ data: rows }, { data: auth }] = await Promise.all([
    supabase.rpc("group_invite_preview", { p_code: code }),
    supabase.auth.getUser(),
  ]);
  const group = (rows as Preview[] | null)?.[0];
  if (!group) notFound();
  const kind = isGroupKind(group.kind) ? GROUP_KIND_INFO[group.kind].label : "Group";
  const people = group.member_count === 1 ? "1 member" : `${group.member_count} members`;

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center px-6 py-16 overflow-hidden">
      <Image src="/images/homepage-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-navy-900/70" />
      <div className="relative w-full max-w-md bg-surface rounded-3xl p-8 shadow-[0_12px_40px_rgba(12,32,56,0.35)] text-center">
        <p className="text-xs font-bold tracking-widest uppercase text-gold-600">You&rsquo;re invited</p>
        <h1 className="font-display font-bold text-3xl text-navy-900 mt-1">{group.name}</h1>
        <p className="text-ink-500 mt-1">
          {kind} · {people}
          {group.club_name ? ` · ${group.club_name}` : ""}
        </p>
        {group.about ? <p className="text-ink-900 mt-4 whitespace-pre-line">{group.about}</p> : null}
        {group.owner_first_name ? (
          <p className="text-sm text-ink-500 mt-4">Run by {group.owner_first_name}</p>
        ) : null}
        <ul className="text-left text-sm text-ink-900 grid gap-2 my-6">
          <li>✓ Live scoring for your outings, with a leaderboard everyone can follow</li>
          <li>✓ Find a game — members share spare places in their fourballs</li>
          <li>✓ Buy and sell golf gear, with Buyer Protection</li>
        </ul>
        <JoinGroupForm code={code} groupName={group.name} signedIn={!!auth.user} />
      </div>
    </div>
  );
}
