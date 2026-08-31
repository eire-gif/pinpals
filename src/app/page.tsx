import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      {/* HERO */}
      <div className="relative text-white overflow-hidden">
        <Image
          src="/images/homepage-sunset.png"
          alt="Sunset over a links golf course"
          fill
          priority
          className="object-cover -z-10"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.42)] to-[rgba(9,22,40,0.62)] -z-10" />
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-28">
          <div className="max-w-[680px]">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
              <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Ireland&rsquo;s golf community
            </span>
            <h1 className="font-display font-bold text-4xl md:text-6xl leading-[1.05] mt-3">
              Find your <em className="text-gold-500 italic">next four ball</em>, anywhere in Ireland.
            </h1>
            <p className="text-white/90 text-lg mt-5 max-w-[52ch]">
              Pinpals connects golfers across all 32 counties so you can meet playing partners,
              book rounds at each other&rsquo;s home clubs, and find your people in the game.
            </p>
            <div className="flex flex-wrap gap-3.5 mt-7">
              <Link href="/signup" className="px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition">
                Join the community
              </Link>
              <Link href="/courses" className="px-6 py-3.5 rounded-full font-bold border-[1.5px] border-white/35 hover:border-white/70 transition">
                Browse 373 Irish courses
              </Link>
            </div>
            <div className="flex flex-wrap gap-9 mt-6 pt-5 border-t border-white/20">
              <Stat value="373" label="Courses listed" />
              <Stat value="32" label="Counties covered" />
              <Stat value="Free" label="To join" />
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section className="py-20 max-w-6xl mx-auto px-6">
        <div className="max-w-xl mb-10">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> How it works
          </span>
          <h2 className="font-display font-bold text-3xl md:text-4xl mt-2.5">
            From stranger on a forum to steady playing partner.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
          <Step n="01" title="Build your profile" body="Tell us your home club, handicap and the county you play in most. It takes two minutes." />
          <Step n="02" title="Find golfers nearby" body="Search the community by club, county or handicap band to find players near you." />
          <Step n="03" title="Play together" body="Reach out, set up a round, and build a regular group of playing partners." />
        </div>
      </section>

      {/* COURSES */}
      <section className="py-20 bg-surface-tint">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-8">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
              <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Every county, every links
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl mt-2.5">
              373 clubs on the books, from Ballybunion to Warrenpoint.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <CourseCard img="/images/dunes.jpg" tag="Links · Kerry" name="Ballybunion Golf Club" />
            <CourseCard img="/images/heather.jpg" tag="Links · Down" name="Royal County Down Golf Club" />
            <CourseCard img="/images/misty.jpg" tag="Parkland · Meath" name="Nearby classic courses" />
          </div>
          <Link href="/courses" className="inline-block mt-6 px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition">
            See the full course directory
          </Link>
        </div>
      </section>

      {/* MARKETPLACE TEASER */}
      <section className="relative py-24 text-white overflow-hidden">
        <Image src="/images/sell-cta.jpg" alt="Golf clubs ready to be sold" fill className="object-cover -z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(9,22,40,0.94)] via-[rgba(9,22,40,0.82)] to-[rgba(9,22,40,0.5)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-lg">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
              <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl mt-2.5">
              Clearing out the garage? Sell your old clubs to a fellow golfer.
            </h2>
            <p className="text-white/85 mt-3 max-w-[50ch]">
              List drivers, irons, bags and gear in minutes, and browse what other Pinpals
              members are selling near you — no fees to list, just golfers dealing with golfers.
            </p>
            <div className="flex flex-wrap gap-3.5 mt-6">
              <Link href="/marketplace" className="px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition">
                Browse the marketplace
              </Link>
              <Link href="/marketplace/new" className="px-6 py-3.5 rounded-full font-bold border-[1.5px] border-white/35 hover:border-white/70 transition">
                Sell your gear
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 text-white text-center overflow-hidden">
        <Image src="/images/hero.jpg" alt="" fill className="object-cover -z-10" />
        <div className="absolute inset-0 bg-gradient-to-br from-[rgba(9,22,40,0.92)] to-[rgba(9,22,40,0.55)] -z-10" />
        <div className="max-w-xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Free to join
          </span>
          <h2 className="font-display font-bold text-3xl md:text-4xl mt-2.5">
            Your next round starts with one profile.
          </h2>
          <p className="text-white/85 mt-3">
            Join golfers from Donegal to Kerry building a community around the game.
          </p>
          <Link href="/signup" className="inline-block mt-6 px-6 py-3.5 rounded-full font-bold bg-[#fbf8ef] text-navy-900 hover:bg-white transition">
            Create your profile
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong className="block font-display font-bold text-3xl text-gold-500">{value}</strong>
      <span className="text-[13px] uppercase tracking-wider text-white/75">{label}</span>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-7 shadow-sm">
      <span className="font-display font-bold text-3xl text-gold-600">{n}</span>
      <h3 className="font-display font-bold text-xl mt-3.5 mb-2">{title}</h3>
      <p className="text-ink-500">{body}</p>
    </div>
  );
}

function CourseCard({ img, tag, name }: { img: string; tag: string; name: string }) {
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 shadow-md">
      <Image src={img} alt={name} fill className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
      <div className="absolute left-0 right-0 bottom-0 p-5 text-white">
        <span className="text-[11.5px] uppercase tracking-wider text-gold-500 font-bold">{tag}</span>
        <h3 className="font-display font-bold text-xl mt-1.5">{name}</h3>
      </div>
    </div>
  );
}
