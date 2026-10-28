import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of use | PinPals",
  description:
    "The rules for using PinPals: accounts, tee times, groups and societies, live scoring, the marketplace, content, and our responsibilities.",
  alternates: { canonical: "/terms" },
};

/**
 * Terms of use (Oct 2026). Plain English, matching how PinPals works: members
 * arrange golf and settle payments between themselves; PinPals provides the
 * tools. TODO once the company is registered: its legal name in "About these
 * terms".
 */
const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms apply when you use PinPals — the pinpals.ie website and the PinPals apps. By creating an account
          or using PinPals you agree to them. Our{" "}
          <Link href="/privacy" className="text-green-700 font-semibold">
            Privacy policy
          </Link>{" "}
          explains how we handle your data.
        </p>
        <p>
          PinPals is run from Ireland. Nothing in these terms takes away your rights as a consumer under Irish or EU
          law.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <Bullets>
        <li>You must be 13 or over. Members aged 13–15 need a parent or guardian to approve their account.</li>
        <li>Some features are only for members aged 18 and over: tee times, Social, chat and selling in the marketplace.</li>
        <li>Use your real name and date of birth, and keep your details up to date.</li>
        <li>One account per person. Keep your sign-in safe; you&rsquo;re responsible for what happens on your account.</li>
      </Bullets>
    ),
  },
  {
    id: "conduct",
    title: "Playing fair",
    body: (
      <>
        <p>PinPals works because golfers trust each other. You agree not to:</p>
        <Bullets>
          <li>harass, threaten, abuse or discriminate against anyone;</li>
          <li>post anything illegal, hateful, sexual, violent or misleading, or that you don&rsquo;t have the right to share;</li>
          <li>pretend to be someone else, or misstate your handicap or scores to gain an advantage;</li>
          <li>spam members, or use PinPals to advertise without our agreement;</li>
          <li>scrape, copy or interfere with PinPals, or try to get around its age, safety or security features.</li>
        </Bullets>
        <p>
          Report anything that breaks these rules from the menu on a profile, post, listing or message. We may remove
          content, limit features or suspend or close accounts that break them.
        </p>
      </>
    ),
  },
  {
    id: "golf",
    title: "Tee times, groups and societies",
    body: (
      <>
        <p>
          PinPals helps members find each other and arrange golf. The arrangement — the tee time, green fees, the
          round itself — is between the members involved and the golf club. PinPals isn&rsquo;t a party to it and
          doesn&rsquo;t book tee times with clubs.
        </p>
        <Bullets>
          <li>Turn up when you&rsquo;ve said you will, or cancel in good time. Your reliability score reflects this.</li>
          <li>Follow each club&rsquo;s own rules, dress code and etiquette.</li>
          <li>
            Group and society organisers are responsible for their events, entries, results and any money they collect.
            Payment details they show (bank, Revolut, cash) are theirs; PinPals doesn&rsquo;t handle those payments.
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: "scoring",
    title: "Scores, handicaps, maps and weather",
    body: (
      <Bullets>
        <li>
          Scores, results and the handicap indicator are for members&rsquo; own games. They aren&rsquo;t official World
          Handicap System records — your official handicap is the one held by your national golf union.
        </li>
        <li>
          Course details, GPS distances, hole maps and weather come from outside sources and your phone&rsquo;s GPS. We
          work to keep them accurate, but they can be wrong — use your own judgement on the course.
        </li>
        <li>Rules of Golf summaries are a plain-English guide; the official R&amp;A wording always decides.</li>
      </Bullets>
    ),
  },
  {
    id: "marketplace",
    title: "The marketplace",
    body: (
      <>
        <p>
          The marketplace lets members advertise golf equipment. Sales are between the buyer and the seller, who
          arrange payment and handover themselves. PinPals isn&rsquo;t the seller, doesn&rsquo;t hold money, and
          isn&rsquo;t responsible for the items or the sale.
        </p>
        <Bullets>
          <li>Sellers: describe items honestly, own what you sell, and only list golf equipment that is legal to sell.</li>
          <li>Buyers: see the item before you pay where you can — meeting at the club is a good choice — and never pay a stranger in advance by bank transfer.</li>
          <li>Offers and comments on a listing are public.</li>
          <li>Shops and traders must say they are selling as a business.</li>
        </Bullets>
      </>
    ),
  },
  {
    id: "content",
    title: "Your content",
    body: (
      <p>
        You keep ownership of the photos, videos, posts, reviews and other content you add. You give PinPals permission
        to store and show it on PinPals to the people you share it with, and to use it to run PinPals. If you delete it
        or your account, we stop showing it, apart from copies others have already shared or that we must keep by law.
      </p>
    ),
  },
  {
    id: "paid",
    title: "Paid features and adverts",
    body: (
      <>
        <p>
          PinPals is free to join. If we offer paid plans, they are bought and cancelled through the App Store or
          Google Play, under their terms, and we&rsquo;ll show the price clearly before you pay.
        </p>
        <p>PinPals may show adverts. Members under 18 never see targeted adverts or adverts for alcohol or betting.</p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Our responsibility to you",
    body: (
      <>
        <p>
          We provide PinPals with reasonable care and skill, and work to keep it available and secure, but we
          can&rsquo;t promise it will always be uninterrupted or error-free.
        </p>
        <p>
          We aren&rsquo;t responsible for what members do — on or off the course — for arrangements and sales between
          members, or for losses we couldn&rsquo;t reasonably have foreseen. Nothing in these terms limits our
          liability for death or personal injury caused by our negligence, for fraud, or for anything else the law
          doesn&rsquo;t allow us to limit.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending your account",
    body: (
      <p>
        You can delete your account at any time, in the app (Profile) or on the{" "}
        <Link href="/profile/delete" className="text-green-700 font-semibold">
          website
        </Link>
        . We may suspend or close an account that breaks these terms or puts other members at risk; where we can,
        we&rsquo;ll tell you why.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes and the law",
    body: (
      <>
        <p>
          We may update these terms as PinPals changes. We&rsquo;ll update the date at the top, and tell you in the
          app or by email before a significant change takes effect.
        </p>
        <p>
          These terms are governed by Irish law, and the Irish courts have jurisdiction — though if you live elsewhere
          in the EU you can also rely on your local consumer law and courts.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms of use"
      title="Terms of use"
      intro={
        <p>
          The short version: be a good playing partner, be honest in the marketplace, and remember that games and sales
          are arranged between members — PinPals provides the tools.
        </p>
      }
      sections={sections}
      other={{ href: "/privacy", label: "Privacy policy" }}
    />
  );
}
