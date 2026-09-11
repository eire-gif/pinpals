import type { Connection, Profile } from "@/lib/types";
import { countryName } from "@/lib/regions";
import { AGE_BAND_NOT_SHARED } from "@/lib/age";
import MemberAvatar from "@/components/member-avatar";
import ConnectButton from "@/app/community/connect-button";

/**
 * One golfer, as a card.
 *
 * Extracted from the Find Golfers directory so that /dashboard/connections
 * can render the identical thing. Those two pages had drifted into showing
 * different amounts about the same person — the connections page listed only
 * a name, club and county, with no handicap, no age range and no photo — and
 * the fix for "make them the same" is one component, not two that happen to
 * match until the next change to either.
 *
 * A server component: it holds no state, and ConnectButton below is the only
 * interactive part, which is a client component in its own right.
 */
export default function MemberCard({
  member,
  currentUserId,
  ageBand,
  connection,
}: {
  member: Profile;
  currentUserId: string;
  /** From the member_age_bands view, never from a date of birth — see
   * supabase/migrations/0059. Absent means "not set, or not shared", and
   * both read the same way on purpose. */
  ageBand?: string;
  /** The viewer's connection to this member, in either direction. Undefined
   * means they've never been connected, which is what ConnectButton renders
   * its "Connect" state from. */
  connection?: Connection;
}) {
  const name = `${member.first_name} ${member.last_name}`;
  const isMe = member.id === currentUserId;

  // handicap_visible (0004) was ignored here once, so a member who had made
  // their handicap private still had it shown to the whole directory. It now
  // reads "Not shared", exactly as an unshared age band does — one
  // consistent way of saying "they've chosen not to say".
  const handicapLabel =
    member.handicap != null && member.handicap_visible
      ? String(member.handicap)
      : AGE_BAND_NOT_SHARED;

  return (
    <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition">
      <div className="flex items-center gap-4 min-w-0">
        <MemberAvatar name={name} avatarUrl={member.avatar_url} color={member.avatar_color} size="xl" />
        <div className="min-w-0">
          <h3 className="font-display font-bold text-lg truncate">
            {name} {isMe && <span className="text-green-700 text-xs font-sans">(you)</span>}
          </h3>
          <p className="text-sm text-ink-500 truncate">{member.home_club}</p>
          {/* The country, small, under the club. Two members can hold the
              same club name in different countries now (0062), so this is
              what tells a searcher which Woodbrook they're looking at. */}
          {member.country && (
            <p className="text-xs text-ink-500 truncate mt-0.5">{countryName(member.country)}</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 mt-5">
        <div className="min-w-0">
          <dt className="text-xs text-ink-500">County</dt>
          <dd className="text-sm font-semibold text-ink-900 mt-0.5 truncate">
            {member.county ?? AGE_BAND_NOT_SHARED}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-500">Handicap</dt>
          <dd className="text-sm font-semibold text-red-600 mt-0.5 truncate">{handicapLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-500">Age range</dt>
          <dd className="text-sm font-semibold text-ink-900 mt-0.5 truncate">
            {ageBand ?? AGE_BAND_NOT_SHARED}
          </dd>
        </div>
      </dl>

      <div className="border-t border-line mt-5 pt-4">
        {isMe ? (
          <span className="text-sm text-ink-500">This is your profile</span>
        ) : (
          <ConnectButton
            memberId={member.id}
            initialStatus={connection?.status}
            incoming={connection?.recipient_id === currentUserId}
          />
        )}
      </div>
    </div>
  );
}
