import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_DOCUMENTS, OPERATOR, SUPERVISORY_AUTHORITY, formatEffectiveDate } from "@/lib/legal";
import { documentSha256 } from "@/lib/legal/hash";
import type { MemberCurrentConsent, MemberPrivateDetails } from "@/lib/consent";
import { formatPhoneForDisplay } from "@/lib/phone";
import { MarketingConsentForm, PhoneNumberForm, ReacceptForm } from "./legal-centre";

export const metadata: Metadata = { title: "Legal & privacy | Pinpals" };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * "Legal & privacy" — the member-facing side of the consent record.
 *
 * Three jobs, and the first one is the reason it exists at all: a member
 * has to be able to see what they agreed to, in the version they agreed
 * to, without asking anyone. The second is to make withdrawal of marketing
 * consent exactly one click. The third is to tell them how to exercise the
 * rest of their rights, which is required to be as accessible as the
 * notice itself.
 *
 * A document counts as out of date when EITHER its version string or its
 * content hash has moved since the member accepted it. The hash catches
 * the realistic mistake — text edited without a version bump — which a
 * version comparison alone would silently miss. See src/lib/legal/hash.ts.
 */
export default async function LegalCentrePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/legal");

  const [{ data: consents }, { data: privateDetails }] = await Promise.all([
    supabase
      .from("member_current_consents")
      .select("*")
      .eq("user_id", user.id)
      .returns<MemberCurrentConsent[]>(),
    supabase
      .from("member_private_details")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle<MemberPrivateDetails>(),
  ]);

  const byType = new Map((consents ?? []).map((row) => [row.consent_type, row]));

  const documentStatuses = LEGAL_DOCUMENTS.map((doc) => {
    const accepted = byType.get(doc.consentType);
    const currentHash = documentSha256(doc);
    const upToDate =
      !!accepted &&
      accepted.granted &&
      accepted.document_version === doc.version &&
      accepted.content_sha256 === currentHash;
    return { doc, accepted, upToDate };
  });

  const outstanding = documentStatuses.filter((status) => !status.upToDate);
  const ageDeclaration = byType.get("age_18_declaration");
  const marketing = byType.get("marketing_email");
  const subscribed = marketing?.granted ?? false;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link href="/dashboard" className="text-sm text-green-700 font-bold">
        &larr; Back to dashboard
      </Link>
      <h1 className="font-display font-bold text-2xl mt-3 mb-1">Legal &amp; privacy</h1>
      <p className="text-ink-500 mb-8">
        What you&rsquo;ve agreed to, what we hold, and what you can do about it.
      </p>

      {/* ============ Outstanding acceptances ============ */}
      {outstanding.length > 0 && (
        <section className="bg-surface border-[1.5px] border-gold-600 rounded-2xl p-6 mb-6">
          <h2 className="font-display font-bold text-lg mb-1.5">
            {outstanding.length === 1
              ? "One document needs your attention"
              : `${outstanding.length} documents need your attention`}
          </h2>
          <p className="text-sm text-ink-900/90 leading-relaxed mb-4">
            {outstanding.every((status) => !status.accepted)
              ? "We don't have a record of you accepting these. Please read them and confirm."
              : "These have changed since you last accepted them. Please have a read and confirm you're happy."}
          </p>
          <ul className="flex flex-col gap-2 mb-5">
            {outstanding.map(({ doc, accepted }) => (
              <li key={doc.slug} className="text-sm">
                <Link
                  href={`/legal/${doc.slug}`}
                  className="font-bold text-green-700 underline underline-offset-2"
                >
                  {doc.title}
                </Link>
                <span className="text-ink-500">
                  {" "}
                  &mdash; now version {doc.version}
                  {accepted?.document_version ? `, you accepted ${accepted.document_version}` : ", not yet accepted"}
                </span>
              </li>
            ))}
          </ul>
          <ReacceptForm outstandingCount={outstanding.length} />
        </section>
      )}

      {/* ============ The record ============ */}
      <section className="bg-surface border border-line rounded-2xl p-6 mb-6">
        <h2 className="font-display font-bold text-lg mb-1">Your agreements</h2>
        <p className="text-sm text-ink-500 mb-5">
          The version of each document you accepted, and when.
        </p>

        <div className="flex flex-col divide-y divide-line">
          {documentStatuses.map(({ doc, accepted, upToDate }) => (
            <div key={doc.slug} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/legal/${doc.slug}`}
                    className="font-bold text-sm text-ink-900 hover:text-green-700 transition"
                  >
                    {doc.title}
                  </Link>
                  <p className="text-xs text-ink-500 mt-1">
                    {accepted?.granted
                      ? `You accepted version ${accepted.document_version ?? "—"} on ${formatWhen(accepted.occurred_at)}.`
                      : "No acceptance recorded."}
                  </p>
                  <p className="text-xs text-ink-500">
                    Current: version {doc.version}, in effect from {formatEffectiveDate(doc.effectiveFrom)}.
                  </p>
                </div>
                <span
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    upToDate ? "bg-green-100 text-green-700" : "bg-gold-400/25 text-ink-900"
                  }`}
                >
                  {upToDate ? "Up to date" : "Needs review"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-500 mt-5 pt-4 border-t border-line">
          {ageDeclaration?.granted
            ? `You confirmed you are 18 or over on ${formatWhen(ageDeclaration.occurred_at)}.`
            : "We don't have a record of your confirmation that you are 18 or over."}
        </p>
      </section>

      {/* ============ Marketing ============ */}
      <section className="bg-surface border border-line rounded-2xl p-6 mb-6">
        <h2 className="font-display font-bold text-lg mb-1">Marketing email</h2>
        <p className="text-sm text-ink-500 mb-5">
          {marketing
            ? `Last changed ${formatWhen(marketing.occurred_at)}.`
            : "You haven't been asked about this yet."}{" "}
          This is separate from your{" "}
          <Link href="/dashboard/notifications" className="text-green-700 font-bold">
            notification settings
          </Link>
          , which control emails about activity on the site.
        </p>
        <MarketingConsentForm subscribed={subscribed} />
      </section>

      {/* ============ Phone ============ */}
      <section className="bg-surface border border-line rounded-2xl p-6 mb-6">
        <h2 className="font-display font-bold text-lg mb-1">Your phone number</h2>
        <p className="text-sm text-ink-500 mb-5">
          Optional, and never shown to other members. We&rsquo;d only use it to reach you about your
          account. Clear the box and save to remove it.
        </p>
        <PhoneNumberForm
          currentNumber={privateDetails?.phone_e164 ?? null}
          displayNumber={formatPhoneForDisplay(privateDetails?.phone_e164 ?? null)}
        />
      </section>

      {/* ============ Rights ============ */}
      <section className="bg-surface border border-line rounded-2xl p-6">
        <h2 className="font-display font-bold text-lg mb-1">Your data</h2>
        <p className="text-sm text-ink-900/90 leading-relaxed">
          You can ask for a copy of everything we hold about you, have it corrected, have it
          deleted, or object to how we use it. Most of your profile you can edit yourself on your{" "}
          <Link href="/profile/edit" className="text-green-700 font-bold">
            profile page
          </Link>
          . For anything else, write to{" "}
          <a href={`mailto:${OPERATOR.dataProtectionContact}`} className="text-green-700 font-bold">
            {OPERATOR.dataProtectionContact}
          </a>{" "}
          — there&rsquo;s no charge and you don&rsquo;t need to give a reason.
        </p>
        <p className="text-sm text-ink-500 leading-relaxed mt-3">
          The{" "}
          <Link href="/legal/privacy" className="text-green-700 font-bold">
            Privacy Policy
          </Link>{" "}
          explains all of this in full. If you&rsquo;re unhappy with how we&rsquo;ve handled your
          data, you can complain to the {SUPERVISORY_AUTHORITY.name} at{" "}
          <a
            href={SUPERVISORY_AUTHORITY.website}
            target="_blank"
            rel="noreferrer"
            className="text-green-700 font-bold"
          >
            dataprotection.ie
          </a>
          .
        </p>
      </section>
    </div>
  );
}
