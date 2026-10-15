import type { Metadata } from "next";
import Link from "next/link";

import { loadConsole } from "@/lib/society-console/access";
import { positiveInt } from "@/lib/society-console/rules";

// Per member (a committee member gets the society admin link): never cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Group · PinPals", robots: { index: false, follow: false } };

/**
 * Where a group notification's link lands on the website (an email). Groups
 * live in the app: with it installed the same link opens the group there
 * (alert-routes.ts maps /groups/<id>); on the web we say so plainly — and
 * someone on a society's committee gets a way into its society admin.
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const groupId = positiveInt((await params).id);
  const committee = groupId ? await loadConsole(groupId) : null;

  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center">
      <div className="bg-surface rounded-2xl shadow-lg p-10">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Groups
        </span>
        {committee ? (
          <>
            <h1 className="font-display font-bold text-3xl mt-3">{committee.society.name}</h1>
            <p className="text-ink-500 mt-3">You&apos;re on the committee. Requests, events, payments and members are all in society admin.</p>
            <Link
              href={`/society/${committee.society.id}`}
              className="inline-block mt-7 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
            >
              Open society admin
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display font-bold text-3xl mt-3">Open this group in the PinPals app</h1>
            <p className="text-ink-500 mt-3">Your crews, trips and societies — invitations, requests and members — live in the app.</p>
            <Link
              href="/dashboard"
              className="inline-block mt-7 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
            >
              Go to your dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
