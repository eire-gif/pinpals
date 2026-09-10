import { describe, it, expect } from "vitest";
import { parseSitemap, isWithinSection } from "./sitemap";

// The DP World Tour's index, as served at /sitemap-article.xml.
const DPWORLD_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.europeantour.com/sitemap-article/2026-07.xml</loc>
    <lastmod>2026-07-31</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.europeantour.com/sitemap-article/latest.xml</loc>
    <lastmod>2026-09-10</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.europeantour.com/sitemap-article/2026-08.xml</loc>
    <lastmod>2026-08-31</lastmod>
  </sitemap>
</sitemapindex>`;

// One entry from /sitemap-article/latest.xml, reproduced tag for tag.
const DPWORLD_URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://www.europeantour.com/dpworld-tour/news/articles/detail/31-and-counting-padraig-harrington-set-for-record-national-open-appearance-at-amgen-irish-open/</loc>
    <lastmod>2026-09-09</lastmod>
    <news:news>
      <news:publication>
        <news:name>31 and counting - P&#225;draig Harrington set for record national open appearance</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-09-09T16:16:52.428Z</news:publication_date>
      <news:title>31 and counting - P&#225;draig Harrington set for record national open appearance</news:title>
    </news:news>
    <image:image>
      <image:loc>https://www.europeantour.com/api/images/image/upload/v1788964825/prod/m5jr9gjse6eotu0ddj7u</image:loc>
      <image:caption>P&#225;draig Harrington</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://www.europeantour.com/legends-tour/news/articles/detail/an-older-story/</loc>
    <lastmod>2026-09-01</lastmod>
    <news:news>
      <news:publication><news:name>Legends</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>2026-09-01T09:00:00.000Z</news:publication_date>
      <news:title>An older story</news:title>
    </news:news>
  </url>
</urlset>`;

// Ryder Cup serves a flat urlset with no image block.
const RYDERCUP_URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://www.rydercup.com/news-media/padraig-harrington-named-as-a-vice-captain-for-the-2027-ryder-cup</loc>
    <news:news>
      <news:publication><news:name>Ryder Cup</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>2026-07-29T10:00:00Z</news:publication_date>
      <news:title>P&#225;draig Harrington named as a Vice Captain for the 2027 Ryder Cup</news:title>
    </news:news>
  </url>
</urlset>`;

describe("parseSitemap", () => {
  it("reads an index and orders children newest first", () => {
    const parsed = parseSitemap(DPWORLD_INDEX);
    expect(parsed.kind).toBe("index");
    expect(parsed.entries).toEqual([]);
    expect(parsed.children).toEqual([
      "https://www.europeantour.com/sitemap-article/latest.xml",
      "https://www.europeantour.com/sitemap-article/2026-08.xml",
      "https://www.europeantour.com/sitemap-article/2026-07.xml",
    ]);
  });

  it("reads a news urlset with title, date and image", () => {
    const parsed = parseSitemap(DPWORLD_URLSET);
    expect(parsed.kind).toBe("urlset");
    expect(parsed.entries).toHaveLength(2);

    const [first] = parsed.entries;
    expect(first.loc).toContain("/dpworld-tour/news/articles/detail/");
    expect(first.title).toBe(
      "31 and counting - Pádraig Harrington set for record national open appearance",
    );
    expect(first.publishedAt?.toISOString()).toBe("2026-09-09T16:16:52.428Z");
    expect(first.dateIsPublication).toBe(true);
  });

  it("takes the article URL, not the image URL, from an entry carrying both", () => {
    // Both sit in <loc> elements. Taking the first match in the raw entry
    // works today and breaks the day a template reorders them.
    const [first] = parseSitemap(DPWORLD_URLSET).entries;
    expect(first.loc).toContain("europeantour.com/dpworld-tour");
    expect(first.loc).not.toContain("/api/images/");
    expect(first.imageUrl).toContain("/api/images/");
  });

  it("orders entries newest first", () => {
    const entries = parseSitemap(DPWORLD_URLSET).entries;
    expect(entries[0].publishedAt!.getTime()).toBeGreaterThan(
      entries[1].publishedAt!.getTime(),
    );
  });

  it("reads a urlset with no image block", () => {
    const [entry] = parseSitemap(RYDERCUP_URLSET).entries;
    expect(entry.title).toBe(
      "Pádraig Harrington named as a Vice Captain for the 2027 Ryder Cup",
    );
    expect(entry.imageUrl).toBeNull();
    expect(entry.dateIsPublication).toBe(true);
  });

  it("falls back to lastmod but says the date is not a publication date", () => {
    const plain = `<urlset><url><loc>https://example.com/a</loc><lastmod>2026-05-01</lastmod></url></urlset>`;
    const [entry] = parseSitemap(plain).entries;
    expect(entry.publishedAt?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(entry.dateIsPublication).toBe(false);
    expect(entry.title).toBeNull();
  });

  it("reads a sitemap that declares the news namespace under a different prefix", () => {
    const odd = `<urlset xmlns:n="http://www.google.com/schemas/sitemap-news/0.9">
      <url><loc>https://example.com/a</loc>
        <n:news><n:publication_date>2026-04-02T00:00:00Z</n:publication_date><n:title>Hello</n:title></n:news>
      </url></urlset>`;
    const [entry] = parseSitemap(odd).entries;
    expect(entry.title).toBe("Hello");
    expect(entry.dateIsPublication).toBe(true);
  });

  it("skips entries with no loc rather than throwing", () => {
    const broken = `<urlset><url><lastmod>2026-05-01</lastmod></url><url><loc>https://example.com/a</loc></url></urlset>`;
    expect(parseSitemap(broken).entries).toHaveLength(1);
  });

  it("returns nothing useful for an empty document instead of throwing", () => {
    expect(parseSitemap("").entries).toEqual([]);
    expect(parseSitemap("").children).toEqual([]);
  });
});

describe("isWithinSection", () => {
  it("keeps a URL under the configured section", () => {
    expect(
      isWithinSection(
        "https://www.europeantour.com/dpworld-tour/news/articles/detail/x/",
        "https://www.europeantour.com/dpworld-tour/",
      ),
    ).toBe(true);
  });

  it("rejects a section robots.txt disallows", () => {
    // The DP World Tour's own robots.txt disallows /legends-tour/. Filtering
    // here means we never queue a URL we would have to refuse.
    expect(
      isWithinSection(
        "https://www.europeantour.com/legends-tour/news/articles/detail/x/",
        "https://www.europeantour.com/dpworld-tour/",
      ),
    ).toBe(false);
  });

  it("allows everything when no section is configured", () => {
    expect(isWithinSection("https://www.rydercup.com/news-media/x", null)).toBe(true);
  });
});
