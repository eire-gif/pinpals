import Image from "next/image";
import { AdvertVideo } from "@/components/home/advert-video";
import Link from "next/link";
import { countCoursesByCountry } from "@/lib/courses";
import { createClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";
import { AppTrio, TripPhone } from "@/components/home/app-screens";
import { Avatar, Chip, Eyebrow, FeatureTile, MiniPodium, MiniScorecard } from "@/components/home/feature-previews";

export default async function HomePage() {
  // The hero's buttons depend on whether whoever is reading has an account
  // yet. Costs nothing extra to know: this page already reads cookies (the
  // course count below goes through the same client), so it was never
  // statically cached to begin with.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Read live rather than hardcoded. The number on this page said 373 for
  // months after the directory grew past 2,600 — a stale figure on the first
  // thing a visitor reads is worse than no figure, and the only way it stays
  // right is to not write it down. Same query the /courses page already runs.
  const counts = await countCoursesByCountry();
  const totalCourses = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const courseCount = totalCourses.toLocaleString("en-IE");

  // Defined once and placed differently depending on who's reading — see the
  // two comments in the hero below. Solid green against a navy-scrimmed
  // photograph: the only saturated colour on the hero, which is what makes
  // it the button the eye goes to.
  const postAvailability = (
    <Link
      href="/dashboard/availability/new"
      className="px-6 py-3.5 rounded-full font-bold bg-green-600 text-white hover:bg-green-500 transition shadow-lg shadow-green-900/25"
    >
      Post your availability
    </Link>
  );

  // The marketplace accent (--buy-500, globals.css) — the same orange as
  // "Buy Now" on a listing, at the owner's request, so everything to do
  // with buying and selling wears one colour. Used in exactly two places on
  // this page: here in the hero for a signed-in member, and on the
  // marketplace band further down where everyone sees it.
  //
  // ink-900 text and the buy-700 edge are not stylistic choices copied from
  // BuyNowButton — they are what makes this orange legible. White on it is
  // 1.99:1, far below WCAG AA; ink-900 is 9.22:1. The border is what keeps
  // the button's shape from dissolving into a bright photograph behind it.
  // White, and second in the members' row. The two green/orange buttons
  // beside it start something new; this one answers "what have I already
  // got on?", which is the question a member with a round booked opens the
  // site to ask. Cream rather than a fourth saturated colour: three
  // competing accents in one row is one too many, and this is the calm one.
  const confirmedTeeTimes = (
    <Link
      href="/tee-times/mine"
      className="px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition"
    >
      My rounds
    </Link>
  );

  const listAnItem = (
    <Link
      href="/marketplace/new"
      className="px-6 py-3.5 rounded-full font-bold bg-buy-500 text-ink-900 border-[1.5px] border-buy-700 hover:bg-buy-600 transition shadow-lg shadow-[rgba(80,44,0,0.35)]"
    >
      List an item
    </Link>
  );

  return (
    <div className="bg-[#0A1628] text-[#F2ECE0]">
      {/* HERO — the app, shown with real screens: the satellite hole map is a
          screenshot; Home and Scorecard are redrawn with sample data. */}
      <section className="relative isolate overflow-hidden">
        <Image
          src="/images/homepage-hero.jpg"
          alt="Sunset over an Irish links golf course"
          fill
          priority
          sizes="100vw"
          quality={90}
          className="object-cover object-center -z-20"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,22,40,.94)_0%,rgba(10,22,40,.75)_45%,rgba(10,22,40,.25)_80%),linear-gradient(0deg,#0A1628_0%,rgba(10,22,40,0)_30%)]" />
        <div className="max-w-[1240px] mx-auto px-5 md:px-10 pt-16 md:pt-24 pb-20 flex flex-wrap items-center justify-between gap-10">
          <div className="flex-[1_1_400px] max-w-[460px] flex flex-col gap-6">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-[.18em] uppercase text-gold-400">
              <span className="w-5 h-0.5 bg-gold-400 inline-block" /> Ireland · UK · Spain · Portugal
            </span>
            <h1 className="font-display font-semibold text-5xl md:text-[66px] leading-[1.02] text-white">
              Golf is better
              <br />
              on <em className="text-gold-400">PinPals.</em>
            </h1>
            <p className="text-lg md:text-xl leading-relaxed text-[#D7DDE8]">
              Find your next fourball, run your society, score live on the course, plan the trip away
              and sell the clubs you no longer use.
            </p>
            <StoreBadges />
            <div className="flex flex-wrap gap-3">
              {/* "Join the community" only for someone who hasn't: a
                  signed-in member is offered what they come back to do. */}
              {user ? (
                <>
                  {postAvailability}
                  {confirmedTeeTimes}
                  {listAnItem}
                </>
              ) : (
                <Link href="/signup" className="px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition">
                  Join free on the web
                </Link>
              )}
              <Link href="/courses" className="px-6 py-3.5 rounded-full font-bold border-[1.5px] border-white/55 bg-white/5 hover:bg-white/15 hover:border-white/80 transition text-white">
                Browse {courseCount} courses
              </Link>
            </div>
          </div>
          <AppTrio courseCount={courseCount} />
        </div>
      </section>


<section style={{ borderTop: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)", background: "#0C1B33" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "24px", paddingTop: "30px", paddingBottom: "30px", fontSize: "15px", color: "#C8D0DD" }}>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}><span className="font-display" style={{ color: "#D9AE4A", fontSize: "22px" }}>◆</span>{courseCount} courses: Ireland, the UK, Spain &amp; Portugal</div>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}><span className="font-display" style={{ color: "#D9AE4A", fontSize: "22px" }}>◆</span>Stableford, stroke, matchplay, foursomes, scramble</div>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}><span className="font-display" style={{ color: "#D9AE4A", fontSize: "22px" }}>◆</span>Results worked out to Golf Ireland countback</div>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}><span className="font-display" style={{ color: "#D9AE4A", fontSize: "22px" }}>◆</span>Buy &amp; sell gear, money held until it arrives</div>
</div>
</section>


      <AdvertVideo />


{/* FEATURES — eight tiles, each with a small, real-looking piece of the app.
          Every preview sits in the same 200px window so the headings line up. */}
      <section id="features" className="py-24 md:py-28">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div className="max-w-[640px] flex flex-col gap-4">
              <Eyebrow>Everything in the app</Eyebrow>
              <h2 className="font-display font-semibold text-4xl md:text-[52px] leading-[1.08] text-white">
                One app for the whole golfing year.
              </h2>
            </div>
            <p className="max-w-[420px] text-[17px] leading-relaxed text-[#B9C3D3]">
              From the first tee time of spring to the trip away in autumn: eight things PinPals does for
              you and the people you play with.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureTile
              title="Societies"
              body="Captain and secretary run the show: members, events, entry fees, waiting lists and society handicaps."
            >
              <div className="h-full p-5 flex flex-col justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-display font-bold w-12 h-12 rounded-full bg-gold-400 text-navy-900 flex items-center justify-center shrink-0">
                    PGS
                  </span>
                  <span>
                    <span className="block font-bold text-[15px]">Portmarnock GS</span>
                    <span className="block text-xs text-[#9AA8BE]">Society · 42 members</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip tone="gold">Captain</Chip>
                  <Chip tone="navy">Secretary</Chip>
                  <Chip tone="navy">Handicaps</Chip>
                </div>
                <div className="rounded-xl bg-[#13284A] px-3 py-2.5 text-[13px] flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-semibold">Old Head · Sat 8 Nov</span>
                    <span className="block text-[#9AA8BE] text-xs">Waiting list: 3</span>
                  </span>
                  <Chip tone="green">28 / 32</Chip>
                </div>
              </div>
            </FeatureTile>

            <FeatureTile
              title="Scorecards"
              body="Enter your handicap once; points come from each hole’s stroke index. A playing partner certifies the card with Face ID."
            >
              <MiniScorecard />
            </FeatureTile>

            <FeatureTile
              title="Hole overview"
              body="Satellite view of every hole with GPS yardages to the green and hazards, and your shots marked as you go."
            >
              <Image
                src="/images/app/hole-map.jpg"
                alt="Hole map in the app: satellite view of Portmarnock Links hole 1 with yardages to the aim circle and green"
                fill
                sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 240px"
                className="object-cover"
                style={{ objectPosition: "50% 23%" }}
              />
            </FeatureTile>

            <FeatureTile
              title="Results"
              body="1st, 2nd and 3rd the moment the last card is in, with countbacks shown in full. Any change is marked “Amended”."
            >
              <MiniPodium />
            </FeatureTile>

            <FeatureTile
              title="Social"
              body="A feed of rounds, photos and banter from your pals, plus group chat for every crew, society and trip."
            >
              <div className="h-full p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Avatar initials="TB" colour="#7BE08F" />
                  <span>
                    <b>Tom</b> <span className="text-[#9AA8BE]">at Old Head</span>
                  </span>
                </div>
                <div className="relative flex-1 rounded-xl overflow-hidden">
                  <Image src="/images/old-head-kinsale.jpg" alt="" fill sizes="240px" className="object-cover" />
                </div>
                <div className="flex gap-4 text-xs text-[#9AA8BE]">
                  <span>♥ 24</span>
                  <span>8 comments</span>
                  <span>34 pts</span>
                </div>
              </div>
            </FeatureTile>

            <FeatureTile
              title="Buy & sell"
              body="List the clubs gathering dust in minutes. Buyers pay through PinPals and the money is held until they have the item."
            >
              <div className="h-full p-4 grid grid-cols-2 gap-3">
                {[
                  ["Driver", "10.5° · Stiff", "€180"],
                  ["Irons", "5–PW · Reg", "€320"],
                ].map(([item, spec, price]) => (
                  <div key={item} className="rounded-xl bg-[#13284A] p-2.5 flex flex-col text-xs">
                    <span className="flex-1 rounded-lg bg-[#1E3A60] flex items-center justify-center text-[#9AA8BE] font-semibold">
                      {item}
                    </span>
                    <span className="mt-2">{spec}</span>
                    <b className="font-display text-lg text-gold-400">{price}</b>
                  </div>
                ))}
              </div>
            </FeatureTile>

            <FeatureTile
              title="Groups"
              body="Start a crew with your four-ball, book rounds weeks ahead and fill an empty spot by offering the tee time to members."
            >
              <div className="h-full p-5 flex flex-col justify-between">
                <div className="flex flex-wrap gap-2">
                  <Chip tone="gold">Crews</Chip>
                  <Chip tone="navy">Societies</Chip>
                  <Chip tone="navy">Trips</Chip>
                </div>
                <div>
                  <span className="block font-bold text-[15px]">Saturday Swingers</span>
                  <span className="block text-xs text-[#9AA8BE]">Round booked · Sat 7:42</span>
                </div>
                <div className="flex items-center">
                  <Avatar initials="EM" colour="#E8C46B" />
                  <Avatar initials="TB" colour="#7BE08F" overlap />
                  <Avatar initials="CR" colour="#9AB8E6" overlap />
                  <Avatar initials="+1" colour="#E6A08A" overlap />
                  <span className="ml-3 text-xs text-[#9AA8BE]">Four-ball full</span>
                </div>
              </div>
            </FeatureTile>

            <FeatureTile
              title="Trips away"
              body="A full day-by-day itinerary: flights, hotel, courses and start times, with payment details for the organiser."
            >
              <div className="h-full p-5 flex flex-col justify-between text-[13px]">
                {[
                  ["Fri", "Fly DUB → FAO", "07:10"],
                  ["Sat", "Quinta South · first tee", "09:20"],
                  ["Sun", "Second round", "10:00"],
                ].map(([day, what, time]) => (
                  <div key={day} className="grid grid-cols-[36px_1fr_auto] gap-2 items-baseline">
                    <b className="text-gold-500">{day}</b>
                    <span>{what}</span>
                    <span className="text-[#9AA8BE]">{time}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                  <span className="text-[#9AA8BE]">8 golfers · 3 nights</span>
                  <Chip tone="green">Pay via Revolut</Chip>
                </div>
              </div>
            </FeatureTile>
          </div>
        </div>
      </section>

      {/* LIVE SCORING — the clubhouse TV board, full width. Sample data; the
          QR code on it points at pinpals.ie. */}
      <section className="bg-[#0E1F3B] py-24 md:py-28 border-t border-white/5">
        <div className="max-w-[1240px] mx-auto px-5 md:px-10">
          <div className="flex flex-wrap items-end justify-between gap-10">
            <div className="max-w-[620px] flex flex-col gap-5">
              <Eyebrow>Live scoring</Eyebrow>
              <h2 className="font-display font-semibold text-4xl md:text-[52px] leading-[1.08] text-white">
                Score it live.
                <br />
                Watch it from the bar.
              </h2>
              <p className="text-lg leading-relaxed text-[#C8D0DD]">
                Pick a format, tee it up, and every card feeds one live leaderboard. Put it on the clubhouse
                TV and the room lights up when someone makes a birdie.
              </p>
            </div>
            <ol className="max-w-[440px] flex flex-col gap-3.5">
              {[
                "Stableford, stroke play, matchplay, Scotch foursomes and scrambles",
                "Shots and points worked out from your handicap and each hole’s index",
                "A TV board for the clubhouse, with side prizes and a QR code to follow on your phone",
              ].map((line, i) => (
                <li key={line} className="flex gap-3.5 text-base leading-snug text-[#E8E2D4]">
                  <span className="text-gold-500 font-bold w-6 shrink-0">0{i + 1}</span>
                  {line}
                </li>
              ))}
            </ol>
          </div>

          <figure className="mt-14">
            <div className="rounded-[20px] md:rounded-[28px] bg-[#05080D] p-2 md:p-4 shadow-[0_40px_90px_rgba(0,0,0,.5)] ring-1 ring-white/10">
              <Image
                src="/images/app/tv-leaderboard.jpg"
                alt="The PinPals clubhouse TV leaderboard: live Stableford positions, recent birdies, side prizes and a QR code to follow on your phone"
                width={2000}
                height={1124}
                sizes="(max-width: 1240px) 100vw, 1160px"
                className="w-full h-auto rounded-xl md:rounded-2xl"
              />
            </div>
            <div aria-hidden="true" className="mx-auto w-28 md:w-44 h-5 md:h-8 bg-gradient-to-b from-[#1a222e] to-[#0b0f15]" />
            <div aria-hidden="true" className="mx-auto w-56 md:w-80 h-2 md:h-3 rounded-full bg-[#0b0f15]" />
            <figcaption className="mt-5 text-center text-sm text-[#9AA8BE]">
              The society board on the clubhouse TV. Sample names and scores.
            </figcaption>
          </figure>
        </div>
      </section>



<section style={{ background: "#F2ECE0", color: "#0A1628", padding: "120px 0" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", gap: "70px", alignItems: "center", flexWrap: "wrap-reverse" }}>
<div style={{ flex: "1 1 540px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "20px" }}>

<div style={{ background: "#fff", borderRadius: "22px", padding: "24px", boxShadow: "0 20px 50px rgba(14,31,59,.12)", display: "flex", flexDirection: "column", gap: "16px" }}>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
<div className="font-display" style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#0E1F3B", color: "#E6C46A", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700" }}>PGS</div>
<div><div style={{ fontWeight: "700" }}>Portmarnock Golf Society</div><div style={{ fontSize: "13px", color: "#55627A" }}>Est. 2019 · Annual membership</div></div>
</div>
<div style={{ fontSize: "11px", letterSpacing: ".14em", fontWeight: "700", color: "#8A6A1F" }}>NEXT OUTING</div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div className="font-display" style={{ fontSize: "20px", fontWeight: "600" }}>Old Head Links</div><div style={{ fontSize: "13px", color: "#55627A" }}>Sat 8 Nov · first tee 10:30</div></div><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#E7F2E4", color: "#1F6A2E", padding: "5px 12px", fontSize: "13px", whiteSpace: "nowrap" }}>28 / 32</span></div>
<div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", borderTop: "1px solid #E6DECF", paddingTop: "14px" }}><span>Waiting list: 3</span><span style={{ color: "#8A6A1F", fontWeight: "600" }}>Offer expires in 24h</span></div>
<span style={{ background: "#0E1F3B", color: "#fff", textAlign: "center", borderRadius: "12px", padding: "13px", fontWeight: "600" }}>Request a place</span>
</div>

<div style={{ background: "#0E1F3B", color: "#F2ECE0", borderRadius: "22px", padding: "24px", boxShadow: "0 20px 50px rgba(14,31,59,.18)", display: "flex", flexDirection: "column", gap: "12px" }}>
<div style={{ fontSize: "11px", letterSpacing: ".14em", fontWeight: "700", color: "#D9AE4A" }}>RESULTS · SINGLES STABLEFORD</div>
<div className="font-display" style={{ fontSize: "20px" }}>Captain&rsquo;s Prize 2026</div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "10px" }}>1st</b>Niamh K.</span><b>38</b></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "10px" }}>2nd</b>Ciarán R.</span><span><b>36</b> <span style={{ fontSize: "11px", color: "#9AA8BE" }}>B9 19</span></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "10px" }}>3rd</b>Ruth K.</span><span><b>36</b> <span style={{ fontSize: "11px", color: "#9AA8BE" }}>B9 17</span></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px", border: "0" }}><span><b style={{ color: "#9AA8BE", marginRight: "10px" }}>4th</b>Darragh O.</span><span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#5A3A12", color: "#F5D08A", padding: "3px 8px", fontSize: "11px" }}>Amended</span> <b>35</b></span></div>
<div style={{ fontSize: "12px", color: "#9AA8BE", lineHeight: "1.5" }}>Ties split on back 9, then last 6, 3 and 18th, the Golf Ireland way.</div>
</div>
</div>
<div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: "22px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#8A6A1F" }}>Societies &amp; results</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600" }}>Run your society without the spreadsheet.</h2>
<p style={{ margin: "0", fontSize: "18px", lineHeight: "1.6", color: "#3A4A63" }}>Members request places, the waiting list moves itself, and entry fees are paid by Revolut, bank transfer or cash. When the last card is in, the podium is published to every member. Captains and secretaries also get a full society console here on the web.</p>
<div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
{user ? (
<Link href="/society" className="inline-flex items-center px-6 py-3.5 rounded-full font-bold bg-navy-900 text-white hover:bg-navy-800 transition">Open society admin</Link>
) : (
<Link href="/signup" className="inline-flex items-center px-6 py-3.5 rounded-full font-bold bg-navy-900 text-white hover:bg-navy-800 transition">Join free</Link>
)}
<Link href="/courses" className="inline-flex items-center px-6 py-3.5 rounded-full font-bold border-[1.5px] border-navy-900 text-navy-900 hover:bg-navy-900 hover:text-white transition">Find your home club</Link>
</div>
</div>
</div>
</section>


<section style={{ position: "relative", padding: "130px 0", overflow: "hidden" }}>
<Image src="/images/ballybunion-10th.jpg" alt="" fill sizes="100vw" className="object-cover" />
<div style={{ position: "absolute", inset: "0", background: "linear-gradient(90deg,rgba(10,22,40,.15) 0%,rgba(10,22,40,.55) 50%,rgba(10,22,40,.92) 100%)" }}></div>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ position: "relative", display: "flex", gap: "60px", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
<TripPhone />
<div style={{ flex: "1 1 440px", maxWidth: "500px", display: "flex", flexDirection: "column", gap: "20px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Trips away</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600", color: "#fff" }}>The whole trip, in everyone&rsquo;s pocket.</h2>
<p style={{ margin: "0", fontSize: "18px", lineHeight: "1.6", color: "#D7DDE8" }}>Flights, hotel, courses and start times, day by day. Share it to the group chat or to Instagram and nobody asks &ldquo;what time are we off?&rdquo; again.</p>
</div>
</div>
</section>


<section style={{ background: "#0A1628", padding: "120px 0" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", flexDirection: "column", gap: "46px" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "30px", flexWrap: "wrap" }}>
<div style={{ maxWidth: "620px", display: "flex", flexDirection: "column", gap: "16px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Buy &amp; sell</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600", color: "#fff" }}>Clear out the garage. Fund the new driver.</h2>
</div>
<p style={{ margin: "0", maxWidth: "420px", fontSize: "17px", lineHeight: "1.6", color: "#B9C3D3" }}>Golfer-to-golfer listings, free to list. Pay through PinPals and the money is held until the buyer has their clubs.</p>
</div>
<div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
{listAnItem}
<Link href="/marketplace" className="px-6 py-3.5 rounded-full font-bold border-[1.5px] border-white/35 hover:border-white/70 transition text-white">Browse the marketplace</Link>
</div>
</div>
</section>


<section style={{ background: "#0E1F3B", padding: "120px 0" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", flexDirection: "column", gap: "46px" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "30px", flexWrap: "wrap" }}>
<div style={{ maxWidth: "620px", display: "flex", flexDirection: "column", gap: "16px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Courses</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600", color: "#fff" }}>{courseCount} clubs. Make one your home.</h2>
</div>
<Link href="/courses" style={{ fontWeight: "600", fontSize: "16px", color: "#E6C46A" }}>Explore all courses →</Link>
</div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "20px" }}>
<CourseCard img="/images/ballybunion-10th.jpg" tag="Co. Kerry · Links" name="Ballybunion Golf Club" />
<CourseCard img="/images/old-head-kinsale.jpg" tag="Co. Cork · Links" name="Old Head Golf Links" />
<CourseCard img="/images/misty.jpg" tag="Parkland" name="Nearby classic courses" />
</div>
</div>
</section>


<section style={{ background: "#0A1628", padding: "130px 0 110px", textAlign: "center" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "26px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Launching on iPhone &amp; Android</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.05", fontWeight: "600", color: "#fff", maxWidth: "820px" }}>Find your next fourball.</h2>
<p style={{ margin: "0", fontSize: "18px", color: "#B9C3D3", maxWidth: "560px", lineHeight: "1.6" }}>Free to join. Join on the web today and your account carries straight over to the app.</p>
<div style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center" }}>
<StoreBadges />
</div>
{user ? null : (
<Link href="/signup" className="mt-2 px-7 py-3.5 rounded-full font-bold bg-gold-400 text-navy-900 hover:bg-gold-500 transition">Join free on the web</Link>
)}
</div>
</section>



    </div>
  );
}

// The apps aren't in the stores yet, so these are labels, not links. When
// they are, swap each for the official badge linking to the store listing.
function StoreBadges() {
  return (
    <div className="flex flex-wrap gap-3">
      <StoreBadge store="App Store" lead="Coming soon to the" icon={<rect x="6" y="2" width="12" height="20" rx="3" />} />
      <StoreBadge store="Google Play" lead="Coming soon to" icon={<path d="M6 3 L19 12 L6 21 Z" />} />
    </div>
  );
}

function StoreBadge({ store, lead, icon }: { store: string; lead: string; icon: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 min-h-14 rounded-2xl border border-white/35 bg-[#04080E] text-white pl-4 pr-5 py-2.5">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" aria-hidden="true">
        {icon}
      </svg>
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[11px] opacity-75">{lead}</span>
        <span className="text-lg font-semibold">{store}</span>
      </span>
    </span>
  );
}

function CourseCard({ img, tag, name }: { img: string; tag: string; name: string }) {
  return (
    <Link href="/courses" className="relative block h-[400px] rounded-3xl overflow-hidden text-white">
      <Image src={img} alt={name} fill sizes="(max-width: 640px) 100vw, (max-width: 1240px) 33vw, 380px" className="object-cover" />
      <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-[rgba(10,22,40,.92)] to-transparent">
        <div className="text-xs tracking-[.14em] text-gold-400 font-bold uppercase">{tag}</div>
        <div className="font-display text-[26px]">{name}</div>
      </div>
    </Link>
  );
}
