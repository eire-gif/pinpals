import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy | PinPals",
  description:
    "What PinPals collects, why, who it's shared with, how long it's kept, and your rights under GDPR — for the PinPals website and app.",
  alternates: { canonical: "/privacy" },
};

/**
 * Privacy policy (Oct 2026). Written from what the app and website actually
 * do; when a feature changes what's collected or who it's shared with,
 * change the matching section here and LEGAL_UPDATED.
 *
 * Needed for Google sign-in's consent screen and App Store Connect.
 * TODO once the company is registered: its legal name, number and address in
 * "Who we are".
 */
const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          PinPals (pinpals.ie and the PinPals apps for iPhone, iPad, Android, Apple Watch and Wear OS) is run from
          Dublin, Ireland. We are the &ldquo;controller&rdquo; of the personal data described here, under the EU
          General Data Protection Regulation (GDPR) and the Irish Data Protection Acts.
        </p>
        <p>
          Contact us about anything in this policy at{" "}
          <a href="mailto:info@pinpals.ie" className="text-green-700 font-semibold">
            info@pinpals.ie
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <p>
          <strong>Your account.</strong> Your name, email address, password (stored only as a secure hash) and date
          of birth. If you join with Apple or Google, we receive your name and email address from them (Apple may give
          us a private relay address instead) — never your Apple or Google password.
        </p>
        <p>
          <strong>Your golf profile.</strong> Anything you choose to add: photo, home club, county and country,
          handicap index, bio, Golf Ireland membership number, the games and formats you like, and your mobile number.
          You decide whether your handicap and age range are shown.
        </p>
        <p>
          <strong>What you do on PinPals.</strong> Tee times you post or join; groups, societies and trips; events and
          itineraries; rounds, scores, scorecards, statistics and who certified them; posts, photos, videos, comments,
          reactions and course reviews; messages; marketplace listings, offers and feedback; and the reports you make.
        </p>
        <p>
          <strong>Location.</strong> With your permission, your phone&rsquo;s location — to show tee times and courses
          near you, and, during a round, your distance to the green, the hole you&rsquo;re on and where your shots
          were played. Shot positions are saved with that round&rsquo;s scorecard. During a live round with the lock
          screen card on, location is used in the background until the round ends. We don&rsquo;t track your
          location at any other time.
        </p>
        <p>
          <strong>Voice.</strong> &ldquo;Say scores&rdquo; uses your phone&rsquo;s speech recognition. We receive only
          the scores it hears, never a recording.
        </p>
        <p>
          <strong>Verification.</strong> If you ask for a Verified badge, a photo of your membership card with your
          Golf Ireland number and club. The photo is checked automatically (see &ldquo;Who we share it with&rdquo;) and
          kept only if a person needs to look at it, then deleted once they decide.
        </p>
        <p>
          <strong>Junior members.</strong> For members aged 13–15, a parent or guardian&rsquo;s email address and
          their approval; if a card check is switched on, Stripe checks the parent&rsquo;s card for €0 and it isn&rsquo;t
          kept.
        </p>
        <p>
          <strong>Your device and use.</strong> Your device type, app version and notification token (to send you
          alerts), your IP address (to protect accounts and limit abuse), which sections of PinPals are used (to run
          and improve the service), and an age range your app store may provide.
        </p>
      </>
    ),
  },
  {
    id: "why",
    title: "Why we use it, and on what legal basis",
    body: (
      <Bullets>
        <li>
          <strong>To run PinPals for you</strong> — your account, profile, tee times, groups, live scoring,
          scorecards, messages, the marketplace and notifications (performance of our contract with you).
        </li>
        <li>
          <strong>To keep members safe</strong> — age-appropriate access for under-18s, parent approval for 13–15 year
          olds, reliability scores, Verified badges, scam and abuse protection, and dealing with reports (our
          legitimate interests and legal obligations).
        </li>
        <li>
          <strong>To show your location-based features</strong> — only with your permission, which you can withdraw in
          your phone&rsquo;s settings at any time (consent).
        </li>
        <li>
          <strong>To improve PinPals</strong> — understanding which features are used (legitimate interests).
        </li>
        <li>
          <strong>Adverts</strong> — some adverts are chosen by your county or club. Members under 18 never see
          targeted adverts, or adverts for alcohol or betting (legitimate interests).
        </li>
        <li>
          <strong>To meet the law</strong> — for example, keeping records of transactions (legal obligation).
        </li>
      </Bullets>
    ),
  },
  {
    id: "see",
    title: "Who can see what",
    body: (
      <>
        <p>
          Other signed-in members can see your profile (name, photo, club, and your handicap if you show it), your
          posts and the things you take part in. Members under 18 are shown with more limits: their profile is seen
          only by their parent, approved contacts and people they play with, and under 16 their surname shows as an
          initial.
        </p>
        <p>
          Your mobile number is shared only with the organisers of groups you choose, group by group. Things you share
          with a link — a scorecard, a live round you let someone follow, a tee time, results or a clubhouse TV
          leaderboard — can be seen by anyone with that link.
        </p>
        <p>We never sell your personal data.</p>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>We use these companies to run PinPals. Each only processes data on our instructions:</p>
        <Bullets>
          <li>
            <strong>Supabase</strong> — our database, sign-in and file storage, hosted in Ireland (EU).
          </li>
          <li>
            <strong>Vercel</strong> — hosts the website.
          </li>
          <li>
            <strong>Resend</strong> — sends our emails.
          </li>
          <li>
            <strong>Apple and Google</strong> — sign-in (if you choose it), app store purchases and age signals, and
            push notifications.
          </li>
          <li>
            <strong>Expo</strong> — delivers app updates and push notifications.
          </li>
          <li>
            <strong>Google Maps Platform</strong> — satellite imagery for hole maps (it receives the map area being
            viewed).
          </li>
          <li>
            <strong>Apple WeatherKit and Open-Meteo</strong> — weather for courses and rounds (they receive a
            course&rsquo;s location, not yours).
          </li>
          <li>
            <strong>Anthropic</strong> — reads membership card photos for Verified badges.
          </li>
          <li>
            <strong>Stripe</strong> — payments and the optional parent card check.
          </li>
        </Bullets>
        <p>
          Some of these are based outside the EU. Where your data leaves the EU, it is protected by the EU&rsquo;s
          adequacy decisions (including the EU–US Data Privacy Framework) or Standard Contractual Clauses.
        </p>
        <p>We may also share data if the law requires it, or to protect members from fraud or harm.</p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments between members",
    body: (
      <p>
        Most marketplace sales and society payments are settled directly between members — in cash, by bank transfer
        or Revolut. PinPals shows the payment details an organiser or seller chooses to share, but doesn&rsquo;t
        handle that money or see those transactions.
      </p>
    ),
  },
  {
    id: "keep",
    title: "How long we keep it",
    body: (
      <Bullets>
        <li>Your data is kept while you have an account.</li>
        <li>
          When you delete your account, it is locked straight away and erased 30 days later (the gap lets a mistake be
          undone if you ask).
        </li>
        <li>
          If you have bought or sold through PinPals, the records of those transactions are kept for six years, as Irish
          tax law requires; the rest of the account is anonymised.
        </li>
        <li>Verification photos are deleted as soon as a decision is made.</li>
      </Bullets>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>You can ask to see, correct, download or delete your data, to restrict or object to how we use it, and to withdraw any consent you&rsquo;ve given. Much of this you can do yourself:</p>
        <Bullets>
          <li>
            <strong>Edit your profile</strong> — on your{" "}
            <Link href="/profile/edit" className="text-green-700 font-semibold">
              profile page
            </Link>{" "}
            or in the app.
          </li>
          <li>
            <strong>Download your data</strong> — in the app: Profile → Privacy &amp; security → Download my data.
          </li>
          <li>
            <strong>Delete your account</strong> — in the app (Profile) or on the website (
            <Link href="/profile/delete" className="text-green-700 font-semibold">
              Delete account
            </Link>
            ). If you joined with Apple, deleting also ends PinPals&rsquo; access to your Apple ID.
          </li>
        </Bullets>
        <p>
          For anything else, email{" "}
          <a href="mailto:info@pinpals.ie" className="text-green-700 font-semibold">
            info@pinpals.ie
          </a>
          . We&rsquo;ll reply within one month. If you&rsquo;re unhappy with how we&rsquo;ve handled your data, you
          can complain to the Irish Data Protection Commission (
          <a href="https://www.dataprotection.ie" className="text-green-700 font-semibold">
            dataprotection.ie
          </a>
          ).
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        PinPals is for golfers aged 13 and over. Members aged 13–15 need a parent or guardian to approve their account,
        and members under 18 can&rsquo;t use tee times, Social, chat or marketplace selling, and see no targeted or
        age-restricted adverts. If you think someone under 13 has an account, use &ldquo;May be under 18&rdquo; on
        their profile&rsquo;s report menu or email us, and we&rsquo;ll act on it.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and similar storage",
    body: (
      <p>
        The website uses only the cookies it needs to work: keeping you signed in, remembering a few settings, and
        protecting sign-in. The app stores your sign-in securely on your device (in the iPhone Keychain). We don&rsquo;t
        use advertising cookies or third-party tracking.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        Data is encrypted in transit and at rest. Access to each table is limited by security rules in the database
        itself, staff access is limited and protected with a second sign-in step, and passwords are never stored in a
        readable form.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy, we&rsquo;ll update the date at the top. If a change affects you significantly,
        we&rsquo;ll tell you in the app or by email first.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy policy"
      title="Your privacy on PinPals"
      intro={
        <p>
          PinPals is where golfers find games, score rounds together, run societies and buy and sell gear. This policy
          explains, in plain English, what we collect to do that, why, who sees it, and how to control it.
        </p>
      }
      sections={sections}
      other={{ href: "/terms", label: "Terms of use" }}
    />
  );
}
