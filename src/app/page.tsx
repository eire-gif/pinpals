import Image from "next/image";
import Link from "next/link";
import { countCoursesByCountry } from "@/lib/courses";
import { createClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";
import { AppTrio, LiveScoringPhones, TripPhone } from "@/components/home/app-screens";

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
      href="/tee-times/confirmed"
      className="px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition"
    >
      Confirmed tee times
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


<section style={{ padding: "120px 0 110px" }} id="features">
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", flexDirection: "column", gap: "56px" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "30px", flexWrap: "wrap" }}>
<div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "16px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Everything in the app</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600", color: "#fff" }}>One app for the whole golfing year.</h2>
</div>
<p style={{ margin: "0", maxWidth: "420px", fontSize: "17px", lineHeight: "1.6", color: "#B9C3D3" }}>From the first tee time of spring to the trip away in autumn: eight things PinPals does for you and the people you play with.</p>
</div>

<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: "22px" }}>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}>
<div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
<div className="font-display" style={{ width: "46px", height: "46px", borderRadius: "50%", background: "#D9AE4A", color: "#0A1628", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", fontSize: "16px" }}>PGS</div>
<div><div style={{ fontWeight: "700", fontSize: "15px" }}>Portmarnock GS</div><div style={{ fontSize: "12px", color: "#9AA8BE" }}>Society · 42 members</div></div>
</div>
<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#20385E", color: "#E6C46A" }}>Captain</span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#20385E", color: "#C8D0DD" }}>Secretary</span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#173A2A", color: "#7BE08F" }}>Next: 8 Nov</span></div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Societies</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>Captain and secretary run the show: members, events, entry fees, waiting lists and society handicaps.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box" }}>
<div style={{ display: "grid", gridTemplateColumns: "repeat(10,minmax(0,1fr))", gap: "3px", fontSize: "11px", textAlign: "center" }}>
<span style={{ color: "#8D9BB2" }}>H</span><span style={{ color: "#8D9BB2" }}>1</span><span style={{ color: "#8D9BB2" }}>2</span><span style={{ color: "#8D9BB2" }}>3</span><span style={{ color: "#8D9BB2" }}>4</span><span style={{ color: "#8D9BB2" }}>5</span><span style={{ color: "#8D9BB2" }}>6</span><span style={{ color: "#8D9BB2" }}>7</span><span style={{ color: "#8D9BB2" }}>8</span><span style={{ color: "#8D9BB2" }}>9</span>
<span style={{ color: "#8D9BB2" }}>Pts</span><span>2</span><span style={{ background: "#D9AE4A", color: "#0A1628", borderRadius: "50%", fontWeight: "700" }}>3</span><span>2</span><span>1</span><span>2</span><span>2</span><span>0</span><span>2</span><span>3</span>
</div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
<span style={{ fontSize: "13px", color: "#9AA8BE" }}>Out <b className="font-display" style={{ fontSize: "22px", color: "#fff", marginLeft: "6px" }}>17</b> pts</span>
<span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#173A2A", color: "#7BE08F" }}>✓ Certified</span>
</div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Scorecards</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>Enter your handicap once; points come from each hole&rsquo;s stroke index. A playing partner certifies the card with Face ID.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "12px 16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", gap: "14px", alignItems: "center" }}>
<svg width="74" height="128" viewBox="0 0 74 128" role="img" aria-label="Hole map with yardages">
<rect width="74" height="128" rx="10" fill="#244A2A"></rect>
<path d="M30 118 C24 90 40 70 34 50 C30 36 44 26 40 16" stroke="#5DA34E" strokeWidth="18" fill="none" strokeLinecap="round"></path>
<circle cx="40" cy="15" r="10" fill="#8AD07A"></circle>
<ellipse cx="54" cy="24" rx="6" ry="4" fill="#E9DDAF"></ellipse>
<ellipse cx="22" cy="62" rx="6" ry="4" fill="#E9DDAF"></ellipse>
<rect x="25" y="114" width="10" height="6" rx="2" fill="#D9AE4A"></rect>
<path d="M30 116 L35 64 L40 16" stroke="#fff" strokeWidth="1.4" strokeDasharray="3 3" fill="none"></path>
<circle cx="35" cy="64" r="3" fill="#fff"></circle>
</svg>
<div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
<div><span style={{ color: "#9AA8BE" }}>Hole 7 · Par 4</span></div>
<div><b className="font-display" style={{ fontSize: "26px", color: "#fff" }}>162</b> <span style={{ color: "#9AA8BE" }}>to green</span></div>
<div style={{ color: "#9AA8BE" }}>Front 151 · Back 174</div>
</div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Hole overview</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>Satellite view of every hole with GPS yardages to the green and hazards, and your shots marked as you go.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "10px", paddingBottom: "0" }}>
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", fontSize: "12px" }}><span>Ciarán · 36</span><div style={{ width: "64px", height: "54px", background: "#9AA8BE", color: "#0A1628", borderRadius: "8px 8px 0 0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700" }}>2nd</div></div>
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", fontSize: "12px" }}><span style={{ color: "#E6C46A", fontWeight: "700" }}>Eire · 38</span><div style={{ width: "64px", height: "80px", background: "#D9AE4A", color: "#0A1628", borderRadius: "8px 8px 0 0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700" }}>1st</div></div>
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", fontSize: "12px" }}><span>Ruth · 36*</span><div style={{ width: "64px", height: "40px", background: "#B07A4A", color: "#0A1628", borderRadius: "8px 8px 0 0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700" }}>3rd</div></div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Results</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>1st, 2nd and 3rd the moment the last card is in, with countbacks shown in full. Any change is marked &ldquo;Amended&rdquo;.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "10px" }}>
<div style={{ display: "flex", gap: "10px", alignItems: "center" }}><span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#7BE08F" }}>TB</span><div style={{ fontSize: "13px" }}><b>Tom</b> <span style={{ color: "#9AA8BE" }}>at Old Head</span></div></div>
<div style={{ position: "relative", width: "100%", height: "74px", borderRadius: "10px", overflow: "hidden" }}><Image src="/images/old-head-kinsale.jpg" alt="" fill sizes="300px" className="object-cover" /></div>
<div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#9AA8BE" }}><span>♥ 24</span><span>8 comments</span><span>34 pts</span></div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Social</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>A feed of rounds, photos and banter from your pals, plus group chat for every crew, society and trip.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "10px" }}>
<div style={{ background: "#13284A", borderRadius: "10px", padding: "10px", fontSize: "12px" }}><div style={{ height: "46px", borderRadius: "6px", background: "#1E3A60", display: "flex", alignItems: "center", justifyContent: "center", color: "#8D9BB2" }}>Driver</div><div style={{ marginTop: "8px" }}>10.5° · Stiff</div><b style={{ color: "#E6C46A" }}>€180</b></div>
<div style={{ background: "#13284A", borderRadius: "10px", padding: "10px", fontSize: "12px" }}><div style={{ height: "46px", borderRadius: "6px", background: "#1E3A60", display: "flex", alignItems: "center", justifyContent: "center", color: "#8D9BB2" }}>Irons</div><div style={{ marginTop: "8px" }}>5–PW · Reg</div><b style={{ color: "#E6C46A" }}>€320</b></div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Buy &amp; sell</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>List the clubs gathering dust in minutes. Buyers pay through PinPals and the money is held until they have the item.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}>
<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#D9AE4A", color: "#0A1628" }}>Crews</span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#20385E", color: "#C8D0DD" }}>Societies</span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#20385E", color: "#C8D0DD" }}>Trips</span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div><div style={{ fontWeight: "700", fontSize: "14px" }}>Saturday Swingers</div><div style={{ fontSize: "12px", color: "#9AA8BE" }}>Round booked · Sat 7:42</div></div>
<div style={{ display: "flex" }}><span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#D9AE4A" }}>EM</span><span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#7BE08F", marginLeft: "-8px" }}>TB</span><span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#9AB8E6", marginLeft: "-8px" }}>CR</span><span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#E6A08A", marginLeft: "-8px" }}>+1</span></div>
</div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Groups</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>Start a crew with your four-ball, book rounds weeks ahead and fill an empty spot by offering the tee time to members.</p></div>
</article>


<article style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.09)", borderRadius: "24px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px", color: "#F2ECE0" }}>
<div style={{ background: "#0B1A33", borderRadius: "16px", padding: "16px", border: "1px solid rgba(255,255,255,.06)", minHeight: "150px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
<div style={{ display: "flex", gap: "10px" }}><b style={{ color: "#D9AE4A", width: "44px" }}>Fri</b><span>Fly DUB → FAO · 07:10</span></div>
<div style={{ display: "flex", gap: "10px" }}><b style={{ color: "#D9AE4A", width: "44px" }}>Sat</b><span>Quinta course · first tee 09:20</span></div>
<div style={{ display: "flex", gap: "10px" }}><b style={{ color: "#D9AE4A", width: "44px" }}>Sun</b><span>Second round · 10:00</span></div>
<div style={{ display: "flex", justifyContent: "space-between", color: "#9AA8BE" }}><span>8 golfers · 3 nights</span><span style={{ color: "#7BE08F" }}>Pay via Revolut</span></div>
</div>
<div><h3 className="font-display" style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "600" }}>Trips away</h3><p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#B9C3D3" }}>A full day-by-day itinerary: flights, hotel, courses and start times, with payment details for the organiser.</p></div>
</article>

</div>
</div>
</section>


<section style={{ background: "#0E1F3B", padding: "120px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
<div className="max-w-[1240px] mx-auto px-5 md:px-10 box-border" style={{ display: "flex", gap: "70px", alignItems: "center", flexWrap: "wrap" }}>
<div style={{ flex: "1 1 440px", display: "flex", flexDirection: "column", gap: "22px" }}>
<div style={{ fontWeight: "600", fontSize: "13px", letterSpacing: ".18em", textTransform: "uppercase", color: "#D9AE4A" }}>Live scoring</div>
<h2 className="font-display text-4xl md:text-[52px]" style={{ margin: "0", lineHeight: "1.08", fontWeight: "600", color: "#fff" }}>Score it live.<br />Watch it from the bar.</h2>
<p style={{ margin: "0", fontSize: "18px", lineHeight: "1.6", color: "#C8D0DD" }}>Pick a format, tee it up, and every card feeds one live leaderboard. Put it on the clubhouse TV and the room lights up when someone makes a birdie.</p>
<div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "6px" }}>
<div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}><span style={{ color: "#D9AE4A", fontWeight: "700", width: "26px" }}>01</span><span style={{ fontSize: "16px", lineHeight: "1.5", color: "#E8E2D4" }}>Stableford, stroke play, matchplay, Scotch foursomes and scrambles</span></div>
<div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}><span style={{ color: "#D9AE4A", fontWeight: "700", width: "26px" }}>02</span><span style={{ fontSize: "16px", lineHeight: "1.5", color: "#E8E2D4" }}>Shots and points worked out from your handicap and each hole&rsquo;s index</span></div>
<div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}><span style={{ color: "#D9AE4A", fontWeight: "700", width: "26px" }}>03</span><span style={{ fontSize: "16px", lineHeight: "1.5", color: "#E8E2D4" }}>A TV leaderboard for the clubhouse, with a flash for every birdie</span></div>
</div>
</div>
<div style={{ flex: "1 1 560px", display: "flex", gap: "26px", justifyContent: "center", flexWrap: "wrap" }}>
<LiveScoringPhones />
</div>
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
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div className="font-display" style={{ fontSize: "20px", fontWeight: "600" }}>Old Head Links</div><div style={{ fontSize: "13px", color: "#55627A" }}>Sat 8 Nov · first tee 10:30</div></div><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", fontWeight: "600", background: "#E7F2E4", color: "#1F6A2E" }}>28 / 32</span></div>
<div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", borderTop: "1px solid #E6DECF", paddingTop: "14px" }}><span>Waiting list: 3</span><span style={{ color: "#8A6A1F", fontWeight: "600" }}>Offer expires in 24h</span></div>
<span style={{ background: "#0E1F3B", color: "#fff", textAlign: "center", borderRadius: "12px", padding: "13px", fontWeight: "600" }}>Request a place</span>
</div>

<div style={{ background: "#0E1F3B", color: "#F2ECE0", borderRadius: "22px", padding: "24px", boxShadow: "0 20px 50px rgba(14,31,59,.18)", display: "flex", flexDirection: "column", gap: "12px" }}>
<div style={{ fontSize: "11px", letterSpacing: ".14em", fontWeight: "700", color: "#D9AE4A" }}>RESULTS · SINGLES STABLEFORD</div>
<div className="font-display" style={{ fontSize: "20px" }}>Captain&rsquo;s Prize 2026</div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "10px" }}>1st</b>Eire M.</span><b>38</b></div>
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
<Link href="/society" style={{ background: "#0E1F3B", color: "#fff", padding: "14px 22px", borderRadius: "999px", fontWeight: "600" }}>Open society admin</Link>
) : (
<Link href="/signup" style={{ background: "#0E1F3B", color: "#fff", padding: "14px 22px", borderRadius: "999px", fontWeight: "600" }}>Join free</Link>
)}
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
