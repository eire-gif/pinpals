import type { Metadata } from "next";
import Image from "next/image";
import QRCode from "qrcode";

/** Apple's public TestFlight invite for the PinPals iOS beta. */
const TESTFLIGHT_URL = "https://testflight.apple.com/join/6CaD2kcm";

const title = "Join the PinPals beta | Golf is better on PinPals";
const description =
  "Play PinPals before anyone else. Live scoring, societies, hole maps, golf trips and club sales, all in one app. iPhone beta via TestFlight.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/beta" },
  openGraph: {
    title: "Play PinPals before anyone else — iPhone beta",
    description,
    type: "website",
    siteName: "PinPals",
    url: "https://pinpals.ie/beta",
    images: [{ url: "https://pinpals.ie/images/beta-og.jpg", width: 1200, height: 630, alt: "PinPals iPhone beta: play it before anyone else" }],
  },
  twitter: { card: "summary_large_image", title: "Play PinPals before anyone else", description },
};

const FEATURES = [
  ["Live group scoring", "Everyone's card on one live leaderboard."],
  ["Lock-screen scoring", "Enter your score without opening the app."],
  ["Society results", "1st, 2nd, 3rd and countbacks, done for you."],
  ["GPS hole maps", "Front, centre and back on every hole."],
  ["Golf trips", "Itineraries, tee times and a group chat."],
  ["Buy & sell clubs", "A marketplace for golfers, by golfers."],
] as const;

const STEPS = [
  ["Tap Join the beta", "It opens Apple's TestFlight page for PinPals."],
  ["Get TestFlight", "Apple's free beta app, if you don't have it yet."],
  ["Install PinPals", "Bring your buddies, play a round, tell us everything."],
] as const;

/**
 * The beta invite (Oct 2026). A short, shareable link for WhatsApp groups and
 * socials: pinpals.ie/beta unfurls as a PinPals card (beta-og.jpg) rather than
 * a bare TestFlight link, then sends people on to TestFlight. The QR code is
 * for anyone who opens it on a computer and needs it on their iPhone.
 */
export default async function BetaPage() {
  const qr = await QRCode.toString(TESTFLIGHT_URL, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0c2038", light: "#ffffff" },
  });

  return (
    <div className="pb-20">
      <div className="relative isolate bg-navy-900 text-white pt-14 pb-16 overflow-hidden">
        <Image src="/images/beta-hero.jpg" alt="" fill priority sizes="100vw" className="object-cover object-bottom -z-10 opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.35)] via-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.9)] -z-10" />
        <div className="max-w-3xl mx-auto px-6">
          <span className="inline-flex items-center rounded-full bg-gold-500 text-navy-900 text-xs font-extrabold tracking-widest uppercase px-4 py-2">
            iPhone beta · before full launch
          </span>
          <h1 className="mt-6 font-display text-5xl sm:text-6xl font-bold leading-[1.04]">
            The greatest thing to happen to golf <em className="text-gold-500">in years.</em>
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-white/85 max-w-xl">
            Play PinPals before anyone else. Join our beta testers and help shape the app ahead of launch.
          </p>
          <a
            href={TESTFLIGHT_URL}
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-green-600 hover:bg-green-700 px-8 py-4 text-lg font-bold text-white w-full sm:w-auto"
          >
            Join the beta on iPhone <span aria-hidden="true">→</span>
          </a>
          <p className="mt-4 text-sm text-white/70">
            iPhone only during the beta. Android arrives with the full launch.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 mt-12 grid gap-12">
        <section aria-labelledby="beta-steps">
          <h2 id="beta-steps" className="font-display text-3xl font-bold text-navy-900">On the tee in 60 seconds</h2>
          <ol className="mt-6 grid gap-5">
            {STEPS.map(([head, body], i) => (
              <li key={head} className="flex gap-4 items-start">
                <span className="flex-none w-10 h-10 rounded-full bg-green-700 text-white font-bold flex items-center justify-center">{i + 1}</span>
                <span>
                  <span className="block font-bold text-navy-900 text-lg">{head}</span>
                  <span className="block text-gray-600">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="beta-features">
          <h2 id="beta-features" className="font-display text-3xl font-bold text-navy-900">What you&rsquo;ll be testing</h2>
          <ul className="mt-6 grid sm:grid-cols-2 gap-4">
            {FEATURES.map(([head, body]) => (
              <li key={head} className="rounded-2xl bg-white border border-gray-200 p-5">
                <span className="block font-bold text-navy-900">{head}</span>
                <span className="block text-gray-600 text-sm mt-1">{body}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="beta-qr" className="rounded-3xl bg-navy-900 text-white p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-center">
          <div
            className="w-44 h-44 flex-none rounded-2xl bg-white p-3"
            role="img"
            aria-label="QR code for the PinPals TestFlight beta"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <div>
            <h2 id="beta-qr" className="font-display text-2xl font-bold">On a computer?</h2>
            <p className="mt-2 text-white/80">Scan this with your iPhone camera to join the beta there.</p>
            <a href={TESTFLIGHT_URL} className="mt-4 inline-block text-gold-500 font-bold break-all">
              testflight.apple.com/join/6CaD2kcm
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
