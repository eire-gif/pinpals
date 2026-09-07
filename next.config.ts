import type { NextConfig } from "next";

// The "listing-images" bucket's public objects (see
// supabase/migrations/0003_marketplace.sql,
// 0046_listing_creation_workflow.sql) are served straight from the Supabase
// project's own storage host. next/image refuses to optimise any remote
// host that isn't explicitly allow-listed here — without this, every
// listing photo either 404s through the image optimiser or falls back to
// unoptimised, which is what every existing <Image src={listing.image_url}>
// call site (listing-card.tsx, marketplace/[id]/page.tsx, ...) has silently
// been doing until now. Same NEXT_PUBLIC_SUPABASE_URL fallback as
// src/lib/supabase/config.ts, duplicated rather than imported —
// next.config.ts loads outside the app's normal path-alias resolution, so a
// "@/..." import here isn't guaranteed to resolve the way it does elsewhere.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cicluiabimxklgmpmxmn.supabase.co";
const supabaseHostname = new URL(SUPABASE_URL).hostname;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
