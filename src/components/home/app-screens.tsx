import Image from "next/image";

// Illustrations of the PinPals app for the homepage: the real hole-map
// screenshot, and the Home, Scorecard, Trip and live-leaderboard screens
// redrawn from the app's own layouts with sample data (made-up names and
// scores), so no member's real round or name is shown on the public site.
// Fixed pixel sizes on purpose: they are pictures of a phone, scaled as a
// whole by the wrapper on smaller screens.

export function AppTrio({ courseCount }: { courseCount: string }) {
  return (
    <div
      role="img"
      aria-label="The PinPals app: the Home screen, a hole map with GPS yardages on satellite imagery, and a certified scorecard"
      className="relative w-[306px] h-[288px] sm:w-[462px] sm:h-[435px] lg:w-[680px] lg:h-[640px] shrink-0"
    >
      <div aria-hidden="true" className="absolute left-0 top-0 origin-top-left scale-[0.45] sm:scale-[0.68] lg:scale-100">
<div style={{ position: "relative", width: "680px", height: "640px" }}>


<div style={{ borderRadius: "46px", background: "#04080E", boxShadow: "0 40px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)", position: "absolute", left: "0", top: "70px", width: "250px", padding: "9px", transform: "rotate(-7deg)" }}>
<div style={{ borderRadius: "36px", overflow: "hidden", display: "flex", flexDirection: "column", height: "510px", background: "#F4F0E6", color: "#13203A", position: "relative" }}>
<div style={{ height: "34px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", borderBottom: "1px solid #E3DCCB" }}>
<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><rect y="0" width="14" height="2" rx="1" fill="#1F4A2C"></rect><rect y="5" width="14" height="2" rx="1" fill="#1F4A2C"></rect><rect y="10" width="14" height="2" rx="1" fill="#1F4A2C"></rect></svg>
<b style={{ fontSize: "11px" }}>Home</b>
<svg width="15" height="12" viewBox="0 0 24 18" fill="none" stroke="#1F4A2C" strokeWidth="2" aria-hidden="true"><rect x="1" y="1" width="22" height="16" rx="2"></rect><path d="M1 2l11 8 11-8"></path></svg>
</div>
<div style={{ position: "relative", height: "238px", overflow: "hidden" }}>
<Image src="/images/homepage-hero.jpg" alt="" fill sizes="250px" className="object-cover" />
<div style={{ position: "absolute", inset: "0", background: "rgba(19,32,58,.55)" }}></div>
<div style={{ position: "relative", padding: "12px 13px", display: "flex", flexDirection: "column", gap: "6px" }}>
<div style={{ fontSize: "6.5px", fontWeight: "700", letterSpacing: ".16em", color: "#E2C275" }}>— IRELAND · UK · SPAIN · PORTUGAL</div>
<div className="font-display" style={{ fontSize: "22px", lineHeight: "1.05", color: "#fff", fontWeight: "700" }}>Find your<br /><i style={{ color: "#E2C275" }}>next fourball.</i></div>
<div style={{ fontSize: "8.5px", color: "#fff" }}>{courseCount} clubs, from Ballybunion to the Algarve.</div>
<div style={{ background: "#E2C275", color: "#13203A", borderRadius: "10px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", fontSize: "10px", marginTop: "4px" }}>Find PinPals</div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "5px" }}>
<span style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: "9px", height: "28px", display: "flex", alignItems: "center", padding: "0 8px", color: "#fff", fontSize: "8.5px", fontWeight: "700", background: "rgba(19,32,58,.35)" }}>Post a tee time</span>
<span style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: "9px", height: "28px", display: "flex", alignItems: "center", padding: "0 8px", color: "#fff", fontSize: "8.5px", fontWeight: "700", background: "rgba(19,32,58,.35)" }}>Find a game</span>
<span style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: "9px", height: "28px", display: "flex", alignItems: "center", padding: "0 8px", color: "#fff", fontSize: "8.5px", fontWeight: "700", background: "rgba(19,32,58,.35)" }}>Sell an item</span>
<span style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: "9px", height: "28px", display: "flex", alignItems: "center", padding: "0 8px", color: "#fff", fontSize: "8.5px", fontWeight: "700", background: "rgba(19,32,58,.35)" }}>Share a photo</span>
</div>
</div>
</div>
<div style={{ margin: "-14px 9px 0", position: "relative", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "10px" }}>
<div style={{ display: "flex", gap: "7px", alignItems: "center", padding: "8px" }}><span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#7FA0B8", flex: "none" }}></span><span style={{ flex: "1", border: "1px solid #E3DCCB", borderRadius: "999px", padding: "5px 9px", fontSize: "8px", color: "#6B6F78" }}>How was golf today, Ciarán?</span></div>
<div style={{ display: "flex", borderTop: "1px solid #EEE8DA", fontSize: "8px", fontWeight: "600", textAlign: "center" }}><span style={{ flex: "1", padding: "6px 0" }}>Photo</span><span style={{ flex: "1", padding: "6px 0", borderLeft: "1px solid #EEE8DA" }}>My round</span><span style={{ flex: "1", padding: "6px 0", borderLeft: "1px solid #EEE8DA" }}>Review</span></div>
</div>
<div style={{ margin: "8px 9px 0", background: "#1C2D52", border: "1.5px solid #C9A85A", borderRadius: "12px", padding: "10px", display: "flex", gap: "8px", alignItems: "center", color: "#fff" }}>
<span style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1.5px solid #E2C275", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><rect x="0" y="4" width="3" height="6" fill="#E2C275"></rect><rect x="4.5" y="0" width="3" height="10" fill="#E2C275"></rect><rect x="9" y="5" width="3" height="5" fill="#E2C275"></rect></svg></span>
<span style={{ flex: "1", textAlign: "center" }}><b style={{ fontSize: "13px", display: "block" }}>Live Scoring</b><span style={{ fontSize: "7px", color: "#C8D0DD" }}>Score with your group, watch the leaderboard move</span></span>
</div>
<div style={{ margin: "8px 9px 0", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "10px", padding: "8px", fontSize: "8px" }}><b style={{ fontSize: "9.5px" }}>Your groups &amp; societies</b><div style={{ color: "#6B6F78" }}>Portmarnock GS · Saturday Swingers</div></div>
<div style={{ position: "absolute", left: "0", right: "0", bottom: "0", height: "34px", background: "#F4F0E6", borderTop: "1px solid #E3DCCB", display: "flex", justifyContent: "space-around", alignItems: "center", fontSize: "6.5px", color: "#6B6F78" }}><b style={{ color: "#1F4A2C" }}>Home</b><span>Tee Times</span><span>Market</span><span>Social</span><span>Inbox</span><span>Profile</span></div>
</div>
</div>


<div style={{ borderRadius: "46px", background: "#04080E", boxShadow: "0 40px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)", position: "absolute", left: "418px", top: "84px", width: "250px", padding: "9px", transform: "rotate(6deg)" }}>
<div style={{ borderRadius: "36px", overflow: "hidden", display: "flex", flexDirection: "column", height: "510px", background: "#F4F0E6", color: "#13203A" }}>
<div style={{ height: "34px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 9px", borderBottom: "1px solid #E3DCCB", fontSize: "8.5px" }}>
<span style={{ border: "1px solid #E3DCCB", borderRadius: "999px", padding: "3px 8px", background: "#FBF8F1" }}>‹ Back</span><b style={{ fontSize: "11px" }}>Scorecard</b><span style={{ border: "1px solid #E3DCCB", borderRadius: "999px", padding: "3px 8px", background: "#fff" }}>Home</span>
</div>
<div style={{ margin: "8px 9px 0", background: "#13203A", color: "#fff", borderRadius: "12px", padding: "10px" }}>
<div style={{ fontSize: "6.5px", letterSpacing: ".14em", fontWeight: "700", color: "#E2C275" }}>SAT 11 OCT 2026</div>
<div className="font-display" style={{ fontSize: "16px", fontWeight: "700", marginTop: "2px" }}>Portmarnock Links</div>
<div style={{ fontSize: "6.5px", color: "#C8D0DD", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#3B6FD8", display: "inline-block" }}></span>Blue tees · 18 holes · Index 12.4 · plays off 14</div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "4px", marginTop: "8px", textAlign: "center" }}>
<div style={{ background: "#22314F", borderRadius: "7px", padding: "5px 0" }}><b className="font-display" style={{ fontSize: "16px", color: "#E2C275" }}>84</b><div style={{ fontSize: "6.5px", color: "#C8D0DD" }}>Score</div></div>
<div style={{ background: "#22314F", borderRadius: "7px", padding: "5px 0" }}><b className="font-display" style={{ fontSize: "16px" }}>+11</b><div style={{ fontSize: "6.5px", color: "#C8D0DD" }}>To par</div></div>
<div style={{ background: "#22314F", borderRadius: "7px", padding: "5px 0" }}><b className="font-display" style={{ fontSize: "16px" }}>39</b><div style={{ fontSize: "6.5px", color: "#C8D0DD" }}>Points</div></div>
<div style={{ background: "#22314F", borderRadius: "7px", padding: "5px 0" }}><b className="font-display" style={{ fontSize: "16px" }}>70</b><div style={{ fontSize: "6.5px", color: "#C8D0DD" }}>Net</div></div>
</div>
</div>
<div style={{ margin: "7px 9px 0", background: "#E3EDE2", border: "1px solid #C3D6C1", borderRadius: "10px", padding: "7px 9px", display: "flex", gap: "7px", alignItems: "center" }}>
<span style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#2E6B3A", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg></span>
<span style={{ fontSize: "7px", lineHeight: "1.35" }}><b style={{ fontSize: "8.5px", color: "#1F4A2C" }}>Certified by Tom Byrne</b><br /><span style={{ color: "#2E6B3A", fontWeight: "600" }}>Face ID · 11 Oct, 17:42</span><br /><span style={{ color: "#6B6F78" }}>Changing the scores removes the certificate.</span></span>
</div>
<div style={{ margin: "7px 9px 0", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "8px", overflow: "hidden", fontSize: "7px", textAlign: "center" }}>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", background: "#1F4A2C", color: "#fff", fontWeight: "700", padding: "3px 0" }}><span style={{ textAlign: "left", paddingLeft: "3px" }}>Hole</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>Out</span></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", borderBottom: "1px solid #EEE8DA" }}><span style={{ textAlign: "left", paddingLeft: "3px", color: "#6B6F78" }}>Par</span><span>4</span><span>4</span><span>3</span><span>5</span><span>4</span><span>5</span><span>4</span><span>4</span><span>3</span><b>36</b></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", borderBottom: "1px solid #EEE8DA", color: "#6B6F78", fontSize: "6px" }}><span style={{ textAlign: "left", paddingLeft: "3px" }}>SI</span><span>8</span><span>12</span><span>10</span><span>6</span><span>4</span><span>18</span><span>2</span><span>14</span><span>16</span><span></span></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", alignItems: "center", fontWeight: "700" }}><span style={{ textAlign: "left", paddingLeft: "3px", fontWeight: "600" }}>Score</span><span>4</span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>5</span></span><span>3</span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>6</span></span><span>4</span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>4</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>5</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", outline: "1px solid #A33A2A", outlineOffset: "1px", display: "flex", alignItems: "center", justifyContent: "center" }}>6</span></span><span>3</span><b className="font-display" style={{ fontSize: "9px" }}>40</b></div>
</div>
<div style={{ margin: "5px 9px 0", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "8px", overflow: "hidden", fontSize: "7px", textAlign: "center" }}>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", background: "#1F4A2C", color: "#fff", fontWeight: "700", padding: "3px 0" }}><span style={{ textAlign: "left", paddingLeft: "3px" }}>Hole</span><span>10</span><span>11</span><span>12</span><span>13</span><span>14</span><span>15</span><span>16</span><span>17</span><span>18</span><span>In</span></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", borderBottom: "1px solid #EEE8DA" }}><span style={{ textAlign: "left", paddingLeft: "3px", color: "#6B6F78" }}>Par</span><span>4</span><span>3</span><span>5</span><span>5</span><span>5</span><span>3</span><span>4</span><span>4</span><span>4</span><b>37</b></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", borderBottom: "1px solid #EEE8DA", color: "#6B6F78", fontSize: "6px" }}><span style={{ textAlign: "left", paddingLeft: "3px" }}>SI</span><span>5</span><span>15</span><span>11</span><span>1</span><span>9</span><span>17</span><span>3</span><span>13</span><span>7</span><span></span></div>
<div style={{ display: "grid", gridTemplateColumns: "22px repeat(9,minmax(0,1fr)) 20px", padding: "3px 0", alignItems: "center", fontWeight: "700" }}><span style={{ textAlign: "left", paddingLeft: "3px", fontWeight: "600" }}>Score</span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>5</span></span><span>3</span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>6</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>4</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>6</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>4</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>5</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>5</span></span><span style={{ display: "flex", justifyContent: "center" }}><span style={{ width: "10px", height: "10px", border: "1px solid #A33A2A", outline: "1px solid #A33A2A", outlineOffset: "1px", display: "flex", alignItems: "center", justifyContent: "center" }}>6</span></span><b className="font-display" style={{ fontSize: "9px" }}>44</b></div>
</div>
<div style={{ margin: "7px 9px 0", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "10px", padding: "6px 0", display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", textAlign: "center", fontSize: "6px", color: "#6B6F78" }}>
<div><b className="font-display" style={{ fontSize: "12px", color: "#13203A", display: "block" }}>0</b>Eagles+</div><div><b className="font-display" style={{ fontSize: "12px", color: "#13203A", display: "block" }}>2</b>Birdies</div><div><b className="font-display" style={{ fontSize: "12px", color: "#13203A", display: "block" }}>5</b>Pars</div><div><b className="font-display" style={{ fontSize: "12px", color: "#13203A", display: "block" }}>9</b>Bogeys</div><div><b className="font-display" style={{ fontSize: "12px", color: "#13203A", display: "block" }}>2</b>Doubles+</div>
</div>
<div style={{ margin: "7px 9px 0", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "5px", fontSize: "7.5px", fontWeight: "700", textAlign: "center" }}>
<span style={{ background: "#E2C275", borderRadius: "8px", padding: "9px 0" }}>Post to Social</span><span style={{ background: "#E2C275", borderRadius: "8px", padding: "9px 0" }}>Send</span><span style={{ background: "#E2C275", borderRadius: "8px", padding: "9px 0" }}>Edit</span>
</div>
</div>
</div>


<div style={{ borderRadius: "46px", background: "#04080E", boxShadow: "0 40px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)", position: "absolute", left: "200px", top: "0", width: "268px", padding: "9px", zIndex: "2" }}>
<div style={{ borderRadius: "36px", overflow: "hidden", display: "flex", flexDirection: "column", height: "510px", background: "#2A3A22", position: "relative" }}>
<Image src="/images/app/hole-map.jpg" alt="PinPals hole map: Portmarnock Links hole 1 on satellite imagery with yardages" fill sizes="250px" className="object-cover object-top" />
</div>
</div>


<div style={{ position: "absolute", left: "-30px", top: "6px", zIndex: "3", background: "#F2ECE0", color: "#0A1628", borderRadius: "16px", padding: "10px 14px", boxShadow: "0 20px 40px rgba(0,0,0,.35)", display: "flex", gap: "10px", alignItems: "center", transform: "rotate(-3deg)" }}>
<span style={{ width: "30px", height: "30px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#0A1628", border: "2px solid #0B1A33", flex: "none", background: "#D9AE4A", borderColor: "#F2ECE0" }}>NK</span>
<span style={{ fontSize: "13px", lineHeight: "1.3" }}><b>Niamh</b> birdied the 11th<br /><span style={{ color: "#55627A" }}>Live in Captain&rsquo;s Prize</span></span>
</div>
</div>
      </div>
    </div>
  );
}

export function TripPhone() {
  return (
    <div role="img" aria-label="A trip itinerary in the PinPals app: days, tee times and groups" className="shrink-0">
      <div aria-hidden="true">
<div style={{ borderRadius: "46px", background: "#04080E", boxShadow: "0 40px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)", flex: "none", width: "300px", padding: "10px", transform: "rotate(-4deg)" }}>
<div style={{ borderRadius: "36px", overflow: "hidden", display: "flex", flexDirection: "column", height: "600px", background: "#F4F0E6", color: "#13203A" }}>
<div style={{ height: "40px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", borderBottom: "1px solid #E3DCCB", fontSize: "10px" }}>
<span style={{ border: "1px solid #E3DCCB", borderRadius: "999px", padding: "4px 10px", background: "#FBF8F1" }}>‹ Back</span><b style={{ fontSize: "12px" }}>Algarve 2027</b><span style={{ width: "24px", height: "24px", border: "1px solid #E3DCCB", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="10" height="12" viewBox="0 0 20 24" fill="none" stroke="#13203A" strokeWidth="2.4" aria-hidden="true"><path d="M10 2v14M5 7l5-5 5 5M3 12v10h14V12"></path></svg></span>
</div>
<div style={{ margin: "10px 10px 0", background: "#13203A", color: "#fff", borderRadius: "14px", padding: "12px" }}>
<span style={{ background: "#E2C275", color: "#13203A", borderRadius: "5px", padding: "3px 7px", fontSize: "7.5px", fontWeight: "700", letterSpacing: ".14em" }}>ABROAD · 5 DAYS</span>
<div className="font-display" style={{ fontSize: "22px", fontWeight: "700", marginTop: "6px" }}>Algarve 2027</div>
<div style={{ fontSize: "9px", color: "#E8E2D4" }}>Mon 26 – Fri 30 Apr · Portmarnock GS</div>
<div className="font-display" style={{ fontSize: "16px", color: "#E2C275", marginTop: "6px" }}>24 days to go</div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "5px", marginTop: "8px", textAlign: "center" }}>
<div style={{ background: "#1F2F55", borderRadius: "9px", padding: "6px 0" }}><b style={{ fontSize: "15px", color: "#E2C275" }}>3</b><div style={{ fontSize: "8px" }}>Rounds</div></div>
<div style={{ background: "#1F2F55", borderRadius: "9px", padding: "6px 0" }}><b style={{ fontSize: "15px", color: "#E2C275" }}>12</b><div style={{ fontSize: "8px" }}>Going</div></div>
<div style={{ background: "#1F2F55", borderRadius: "9px", padding: "6px 0" }}><b style={{ fontSize: "15px", color: "#E2C275" }}>4</b><div style={{ fontSize: "8px" }}>Nights</div></div>
</div>
</div>
<div style={{ margin: "10px 10px 0", fontSize: "7.5px", fontWeight: "700", letterSpacing: ".16em", color: "#6B6F78" }}>YOUR TRIP</div>
<div style={{ margin: "5px 10px 0", background: "#13203A", borderRadius: "12px", padding: "9px" }}>
<div style={{ fontSize: "7.5px", fontWeight: "700", letterSpacing: ".14em", color: "#E2C275" }}>YOUR TEE TIMES</div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "5px", marginTop: "6px", textAlign: "center", color: "#fff" }}>
<div style={{ background: "#1F2F55", borderRadius: "7px", padding: "5px 0", fontSize: "7px" }}>MON<b style={{ display: "block", fontSize: "11px" }}>10:10</b></div>
<div style={{ background: "#1F2F55", borderRadius: "7px", padding: "5px 0", fontSize: "7px" }}>WED<b style={{ display: "block", fontSize: "11px" }}>09:40</b></div>
<div style={{ background: "#1F2F55", borderRadius: "7px", padding: "5px 0", fontSize: "7px" }}>THU<b style={{ display: "block", fontSize: "11px" }}>11:20</b></div>
</div>
</div>
<div style={{ display: "flex", gap: "5px", margin: "9px 10px 0" }}>
<div style={{ flex: "1", background: "#13203A", borderRadius: "9px", padding: "5px 0", textAlign: "center" }}><div style={{ fontSize: "7px", color: "#E2C275", fontWeight: "700" }}>MON</div><b style={{ fontSize: "13px", color: "#E2C275" }}>26</b></div>
<div style={{ flex: "1", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "9px", padding: "5px 0", textAlign: "center" }}><div style={{ fontSize: "7px", color: "#6B6F78", fontWeight: "700" }}>TUE</div><b style={{ fontSize: "13px" }}>27</b></div>
<div style={{ flex: "1", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "9px", padding: "5px 0", textAlign: "center" }}><div style={{ fontSize: "7px", color: "#6B6F78", fontWeight: "700" }}>WED</div><b style={{ fontSize: "13px" }}>28</b></div>
<div style={{ flex: "1", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "9px", padding: "5px 0", textAlign: "center" }}><div style={{ fontSize: "7px", color: "#6B6F78", fontWeight: "700" }}>THU</div><b style={{ fontSize: "13px" }}>29</b></div>
<div style={{ flex: "1", background: "#fff", border: "1px solid #E3DCCB", borderRadius: "9px", padding: "5px 0", textAlign: "center" }}><div style={{ fontSize: "7px", color: "#6B6F78", fontWeight: "700" }}>FRI</div><b style={{ fontSize: "13px" }}>30</b></div>
</div>
<div className="font-display" style={{ margin: "10px 10px 0", fontSize: "15px", fontWeight: "700" }}>Day 1 · Monday 26 Apr</div>
<div style={{ margin: "6px 10px 0", background: "#13203A", color: "#fff", borderRadius: "14px", padding: "10px", display: "flex", flexDirection: "column", gap: "7px" }}>
<div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ width: "26px", height: "26px", borderRadius: "7px", background: "#E2C275", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><svg width="11" height="12" viewBox="0 0 20 22" fill="none" stroke="#13203A" strokeWidth="2.4" aria-hidden="true"><path d="M3 21V2h12l-2 4 2 4H3"></path></svg></span><span><span style={{ fontSize: "7px", fontWeight: "700", letterSpacing: ".12em", color: "#E2C275" }}>ROUND · FIRST TEE 10:00</span><b style={{ display: "block", fontSize: "11px" }}>Quinta do Lago South</b><span style={{ fontSize: "8px", color: "#C8D0DD" }}>Stableford · 10 min apart</span></span></div>
<div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "5px" }}>
<div style={{ background: "#1F2F55", borderRadius: "8px", padding: "6px 8px" }}><b style={{ fontSize: "11px" }}>10:00</b><div style={{ fontSize: "7.5px", color: "#C8D0DD" }}>Group 1 · 4</div></div>
<div style={{ background: "#1F2F55", border: "1px solid #E2C275", borderRadius: "8px", padding: "6px 8px" }}><b style={{ fontSize: "11px" }}>10:10</b><div style={{ fontSize: "7.5px", color: "#C8D0DD" }}>Group 2 · 4</div></div>
</div>
<div style={{ fontSize: "8px", color: "#E2C275" }}>You: 10:10 · group 2 with Tom, Ciarán &amp; Ruth</div>
<div style={{ background: "#E2C275", color: "#13203A", borderRadius: "999px", padding: "7px 0", textAlign: "center", fontWeight: "700", fontSize: "10px" }}>▶ Start the round</div>
</div>
</div>
</div>
      </div>
    </div>
  );
}

export function LiveScoringPhones() {
  return (
    <>
<div style={{ borderRadius: "46px", background: "#04080E", boxShadow: "0 40px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)", width: "290px" }}>
<div style={{ borderRadius: "36px", overflow: "hidden", display: "flex", flexDirection: "column", height: "600px", background: "linear-gradient(180deg,#1B3A63 0%,#0E1F3B 45%,#0B1A2E 100%)" }}>
<div style={{ padding: "30px 20px 14px" }}>
<div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontWeight: "700", letterSpacing: ".14em" }}><span style={{ color: "#D9AE4A" }}>CAPTAIN&rsquo;S SCRAMBLE</span><span style={{ color: "#5ED07A" }}>● LIVE</span></div>
<div className="font-display" style={{ fontSize: "24px", marginTop: "8px", color: "#fff" }}>Portmarnock Links</div>
<div style={{ fontSize: "13px", color: "#A9B6CA", marginTop: "2px" }}>Net · 6 teams · updated 2 min ago</div>
</div>
<div style={{ padding: "0 20px", display: "flex", flexDirection: "column" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "11px", letterSpacing: ".12em", color: "#8D9BB2", fontWeight: "700" }}><span>POS · TEAM</span><span>THRU · NET</span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "12px" }}>1</b>The Eagles</span><span>13 <b style={{ color: "#7BE08F", marginLeft: "14px" }}>−8</b></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px", background: "#2A3F5C", margin: "0 -10px", borderRadius: "10px", border: "0" }}><span><b style={{ color: "#D9AE4A", marginRight: "12px" }}>2</b>The Bandits · You</span><span>12 <b style={{ color: "#7BE08F", marginLeft: "14px" }}>−6</b></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "12px" }}>T3</b>Fore Play</span><span>14 <b style={{ marginLeft: "14px" }}>−5</b></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "12px" }}>T3</b>Sand Trappers</span><span>11 <b style={{ marginLeft: "14px" }}>−5</b></span></div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)", fontSize: "14px" }}><span><b style={{ color: "#D9AE4A", marginRight: "12px" }}>5</b>Pin Seekers</span><span>F <b style={{ marginLeft: "14px" }}>−3</b></span></div>
</div>
<div style={{ margin: "18px 16px 0", background: "#D9AE4A", color: "#0A1628", borderRadius: "16px", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div><div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: ".12em" }}>HOLE 13 · PAR 4 · SI 5</div><div style={{ fontSize: "15px", fontWeight: "600", marginTop: "2px" }}>Enter your score</div></div>
<div className="font-display" style={{ fontSize: "30px", fontWeight: "700" }}>4</div>
</div>
</div>
</div>
<div style={{ flex: "none", width: "300px", display: "flex", flexDirection: "column", gap: "14px", alignSelf: "center" }}>
<div style={{ background: "#11264A", border: "1px solid rgba(217,174,74,.45)", borderRadius: "20px", padding: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
<div style={{ fontSize: "11px", letterSpacing: ".14em", fontWeight: "700", color: "#D9AE4A" }}>ON THE CLUBHOUSE TV</div>
<div style={{ fontSize: "15px", lineHeight: "1.5", color: "#E8E2D4" }}>The same board, full screen in the bar, with a flash when someone makes birdie.</div>
</div>
<div style={{ background: "#11264A", border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", padding: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
<div style={{ fontSize: "11px", letterSpacing: ".14em", fontWeight: "700", color: "#D9AE4A" }}>ON EVERY PHONE</div>
<div style={{ fontSize: "15px", lineHeight: "1.5", color: "#E8E2D4" }}>Players and followers watch the same board move, hole by hole.</div>
</div>
</div>
    </>
  );
}
