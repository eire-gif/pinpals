/* eslint-disable @next/next/no-img-element -- a preview of uploaded creatives at their own URLs, not page images */
"use client";

import type { AdFormat, DisplayStyle } from "@/lib/advertising";

// The live phone preview beside the campaign form: roughly how each format
// sits in the app (mobile/src/components/ad-*.tsx), drawn in the app's own
// navy / gold / cream. Not pixel-exact — the app is the truth — but enough
// to catch a creative that's the wrong way round or text under the close
// button.

export type PreviewAd = {
  format: AdFormat;
  displayStyle: DisplayStyle;
  countdownSeconds: number;
  imageUrl: string | null;
  imageWideUrl: string | null;
  imageSquareUrl: string | null;
  headline: string;
  body: string;
  buttonText: string;
  advertiserName: string;
  advertiserLogoUrl: string | null;
};

export default function PhonePreview({ ad }: { ad: PreviewAd }) {
  return (
    <div className="sticky top-6">
      <div className="text-xs uppercase tracking-wide font-semibold text-ink-500 mb-2 text-center">Live preview</div>
      <div className="mx-auto w-[270px] rounded-[2.6rem] bg-navy-900 p-2.5 shadow-xl">
        <div className="relative h-[540px] rounded-[2.1rem] overflow-hidden bg-cream-50">
          {ad.format === "takeover" ? <Takeover ad={ad} /> : null}
          {ad.format === "banner" ? <Banner ad={ad} /> : null}
          {ad.format === "feed" ? <Feed ad={ad} /> : null}
          {ad.format === "course_partner" ? <CoursePartner ad={ad} /> : null}
        </div>
      </div>
      <p className="text-[11px] text-ink-500 text-center mt-2 max-w-[270px] mx-auto">
        {ad.displayStyle === "artwork" ? "Their artwork is shown as is — PinPals only adds the Sponsored label and the close control." : "PinPals lays out the headline, text and button over the photo."}
      </p>
    </div>
  );
}

function Sponsored({ dark = true }: { dark?: boolean }) {
  return (
    <span className={`inline-block text-[9px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full ${dark ? "bg-navy-900/70 text-cream-50" : "bg-cream-100 text-ink-500"}`}>
      Sponsored
    </span>
  );
}

function Empty({ label, className = "" }: { label: string; className?: string }) {
  return <div className={`flex items-center justify-center text-[11px] text-ink-500 bg-cream-100 ${className}`}>{label}</div>;
}

function Takeover({ ad }: { ad: PreviewAd }) {
  return (
    <div className="absolute inset-0 bg-navy-900">
      {ad.imageUrl ? <img src={ad.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <Empty label="Upload the 9:16 image" className="absolute inset-0 bg-navy-800 text-cream-100" />}
      <div className="absolute top-8 left-3">
        <Sponsored />
      </div>
      <div className="absolute top-7 right-3 w-8 h-8 rounded-full border-2 border-gold-400 bg-navy-900/60 text-cream-50 text-xs font-bold flex items-center justify-center" title="Countdown, then a close button">
        {ad.countdownSeconds}
      </div>
      {ad.displayStyle === "photo_headline" && (
        <div className="absolute inset-x-0 bottom-0 pt-16 pb-6 px-4 bg-gradient-to-t from-navy-900 via-navy-900/80 to-transparent">
          <div className="font-display font-bold text-xl text-cream-50 leading-tight">{ad.headline || "Your headline"}</div>
          {ad.body && <div className="text-xs text-cream-100 mt-1.5">{ad.body}</div>}
          <div className="mt-3 rounded-full bg-gold-400 text-navy-900 text-xs font-bold text-center py-2">{ad.buttonText || "Find out more"}</div>
          <div className="text-[9px] text-cream-100/70 text-center mt-2">{ad.advertiserName}</div>
        </div>
      )}
    </div>
  );
}

function FakeScreen({ title }: { title: string }) {
  return (
    <div className="absolute inset-0 pt-8 px-3">
      <div className="font-bold text-sm text-ink-900 text-center mb-3">{title}</div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-surface border border-line mb-2 flex items-center gap-2 px-2">
          <div className="w-11 h-11 rounded-lg bg-cream-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-3/4 rounded bg-cream-100" />
            <div className="h-2 w-1/2 rounded bg-cream-100" />
          </div>
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-cream-50 border-t border-line flex justify-around items-center text-[9px] text-ink-500">
        <span>Home</span>
        <span>Tee times</span>
        <span>Social</span>
        <span>Marketplace</span>
      </div>
    </div>
  );
}

function Banner({ ad }: { ad: PreviewAd }) {
  const wide = ad.imageWideUrl ?? ad.imageUrl;
  return (
    <>
      <FakeScreen title="Courses" />
      <div className="absolute inset-x-2.5 bottom-14 rounded-xl overflow-hidden bg-surface shadow-lg border border-line">
        {ad.displayStyle === "artwork" ? (
          <div className="relative aspect-[4/1] bg-navy-800">
            {wide ? <img src={wide} alt="" className="w-full h-full object-cover" /> : <Empty label="Upload the 4:1 banner" className="w-full h-full" />}
            {/* The close button's corner: the top-right safe zone. */}
            <div className="absolute top-0 right-0 w-[15%] h-[40%] border border-dashed border-gold-400/70" title="Keep text out of here" />
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-navy-900/70 text-cream-50 text-[9px] leading-4 text-center">×</span>
            <span className="absolute bottom-1 left-1">
              <Sponsored />
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2">
            {wide || ad.imageSquareUrl ? <img src={(ad.imageSquareUrl ?? wide)!} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <Empty label="Photo" className="w-12 h-12 rounded-lg" />}
            <div className="flex-1 min-w-0">
              <div className="text-[8px] font-bold tracking-[0.14em] text-gold-600 uppercase">Sponsored · {ad.advertiserName || "Advertiser"}</div>
              <div className="text-[11px] font-bold text-ink-900 leading-tight truncate">{ad.headline || "Your headline"}</div>
            </div>
            <span className="text-[9px] font-bold bg-gold-400 text-navy-900 rounded-full px-2 py-1">{ad.buttonText || "Open"}</span>
          </div>
        )}
        <div className="h-0.5 bg-cream-100">
          <div className="h-full w-2/3 bg-gold-500" />
        </div>
      </div>
    </>
  );
}

function Feed({ ad }: { ad: PreviewAd }) {
  const square = ad.imageSquareUrl ?? ad.imageUrl;
  return (
    <div className="absolute inset-0 pt-8 px-2.5 overflow-hidden">
      <div className="h-24 rounded-xl bg-surface border border-line mb-2" />
      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        <div className="flex items-center gap-2 p-2">
          {ad.advertiserLogoUrl ? (
            <img src={ad.advertiserLogoUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-navy-900 text-gold-400 text-[10px] font-bold flex items-center justify-center">
              {(ad.advertiserName || "A").slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-ink-900 truncate">{ad.advertiserName || "Advertiser"}</div>
            <span className="text-[8px] font-bold tracking-[0.14em] text-gold-600 uppercase">Sponsored</span>
          </div>
          <span className="text-ink-500 text-xs">•••</span>
        </div>
        {ad.displayStyle === "photo_headline" && (ad.headline || ad.body) && (
          <div className="px-2 pb-2">
            {ad.headline && <div className="text-[12px] font-bold text-ink-900">{ad.headline}</div>}
            {ad.body && <div className="text-[10px] text-ink-500">{ad.body}</div>}
          </div>
        )}
        {square ? <img src={square} alt="" className="w-full aspect-square object-cover" /> : <Empty label="Upload the 1:1 image" className="w-full aspect-square" />}
        <div className="flex items-center justify-between gap-2 px-2 py-2 bg-surface-tint">
          <span className="text-[10px] text-ink-500 truncate">{ad.advertiserName || "advertiser"}</span>
          <span className="text-[9px] font-bold bg-navy-900 text-cream-50 rounded-full px-2.5 py-1">{ad.displayStyle === "photo_headline" ? ad.buttonText || "Learn more" : "Learn more"}</span>
        </div>
      </div>
    </div>
  );
}

function CoursePartner({ ad }: { ad: PreviewAd }) {
  const logo = ad.imageUrl ?? ad.advertiserLogoUrl;
  return (
    <div className="absolute inset-0">
      <div className="bg-navy-900 pt-10 pb-4 px-3">
        <div className="font-display font-bold text-lg text-cream-50 leading-tight">Portmarnock Golf Club</div>
        <div className="text-[10px] text-cream-100">Dublin, Ireland</div>
      </div>
      <div className="mx-2.5 mt-2 rounded-xl bg-surface border border-line flex items-center gap-2 p-2">
        {logo ? <img src={logo} alt="" className="w-9 h-9 rounded-lg object-contain bg-cream-50" /> : <Empty label="Logo" className="w-9 h-9 rounded-lg" />}
        <div className="flex-1 min-w-0">
          <div className="text-[8px] font-bold tracking-[0.14em] text-gold-600 uppercase">Course partner</div>
          <div className="text-[11px] font-bold text-ink-900 truncate">{ad.advertiserName || "Advertiser"}</div>
          {ad.displayStyle === "photo_headline" && ad.headline && <div className="text-[10px] text-ink-500 truncate">{ad.headline}</div>}
        </div>
        <span className="text-ink-500 text-xs">›</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-green-800">
        <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-navy-900 px-3 pt-2 pb-3 text-center">
          <div className="text-[9px] text-gold-400 font-bold tracking-[0.14em]">HOLE 7</div>
          <div className="flex justify-around text-cream-50 font-display font-bold">
            <span className="text-sm">142</span>
            <span className="text-xl text-gold-400">151</span>
            <span className="text-sm">163</span>
          </div>
          <div className="mt-1.5 inline-block text-[8px] text-cream-100 bg-cream-50/10 rounded-full px-2 py-0.5">
            Yardages brought to you by {ad.advertiserName || "your sponsor"}
          </div>
        </div>
      </div>
    </div>
  );
}
