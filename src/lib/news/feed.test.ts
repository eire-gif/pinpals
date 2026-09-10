import { describe, it, expect } from "vitest";
import { parseFeed, stripTags } from "./feed";

// Shaped after the real USGA Media Center RSS feed.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>USGA Media Center - Press Releases</title>
  <item>
    <title>Sankaty Head Golf Club to Host 2036 U.S. Women's Mid-Amateur</title>
    <link>https://mediacenter.usga.org/press-releases-sankaty-head</link>
    <guid isPermaLink="false">usga-sankaty-2036</guid>
    <pubDate>Tue, 01 Sep 2026 09:37:00 -0400</pubDate>
    <description>Second USGA championship awarded to Massachusetts club</description>
  </item>
  <item>
    <title><![CDATA[Stout Awarded McCormack Medal & Ceremony]]></title>
    <link>https://mediacenter.usga.org/press-releases-stout</link>
    <pubDate>Wed, 19 Aug 2026 11:46:00 -0400</pubDate>
    <description></description>
  </item>
</channel></rss>`;

// Shaped after a WordPress feed, which is what CPG serves.
const RSS_WITH_CONTENT = `<rss version="2.0"><channel>
  <item>
    <title>Stephen Gallacher Named 2027 European Junior Ryder Cup Captain</title>
    <link>https://cpg.golf/news/ryder-cup/gallacher/</link>
    <guid isPermaLink="true">https://cpg.golf/?p=1234</guid>
    <pubDate>Thu, 25 Jun 2026 12:05:00 +0000</pubDate>
    <description><![CDATA[<p>Short teaser.</p>]]></description>
    <content:encoded><![CDATA[<p>Stephen Gallacher has been named European Captain.</p><p>Six boys and six girls will take on the United States.</p>]]></content:encoded>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Newsroom</title>
  <entry>
    <title>New Driver Announced</title>
    <link rel="alternate" href="https://example.com/releases/driver"/>
    <id>tag:example.com,2026:release/9</id>
    <published>2026-09-01T10:00:00Z</published>
    <content type="html">&lt;p&gt;The company announced a driver.&lt;/p&gt;</content>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items with guid, link and date", () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);

    expect(items[0].externalId).toBe("usga-sankaty-2036");
    expect(items[0].title).toContain("Sankaty Head");
    expect(items[0].link).toBe("https://mediacenter.usga.org/press-releases-sankaty-head");
    expect(items[0].publishedAt?.toISOString()).toBe("2026-09-01T13:37:00.000Z");
    expect(items[0].body).toBe("Second USGA championship awarded to Massachusetts club");
  });

  it("unwraps CDATA and decodes entities in titles", () => {
    const items = parseFeed(RSS);
    expect(items[1].title).toBe("Stout Awarded McCormack Medal & Ceremony");
  });

  it("falls back to the link when a feed omits guid", () => {
    const items = parseFeed(RSS);
    expect(items[1].externalId).toBe("https://mediacenter.usga.org/press-releases-stout");
  });

  it("prefers content:encoded over the shorter description", () => {
    const [item] = parseFeed(RSS_WITH_CONTENT);
    expect(item.body).toContain("Stephen Gallacher has been named European Captain.");
    expect(item.body).toContain("Six boys and six girls");
    expect(item.body).not.toContain("Short teaser");
  });

  it("parses Atom entries, taking the URL from the link attribute", () => {
    const items = parseFeed(ATOM, "atom");
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe("https://example.com/releases/driver");
    expect(items[0].externalId).toBe("tag:example.com,2026:release/9");
    expect(items[0].body).toBe("The company announced a driver.");
  });

  it("detects the real format even when the source row says otherwise", () => {
    // A source configured as RSS that starts serving Atom should keep
    // working rather than silently yielding nothing.
    expect(parseFeed(ATOM, "rss")).toHaveLength(1);
    expect(parseFeed(RSS, "atom")).toHaveLength(2);
  });

  it("returns nothing rather than throwing on junk input", () => {
    expect(parseFeed("not xml at all")).toEqual([]);
    expect(parseFeed("")).toEqual([]);
    expect(parseFeed("<rss><channel></channel></rss>")).toEqual([]);
  });

  it("skips items with no title", () => {
    const xml = `<rss><channel><item><link>https://x.com/a</link></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([]);
  });

  it("leaves an unparseable date null rather than guessing", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://x.com/a</link><pubDate>whenever</pubDate></item></channel></rss>`;
    expect(parseFeed(xml)[0].publishedAt).toBeNull();
  });
});

describe("stripTags", () => {
  it("keeps paragraph breaks but removes markup", () => {
    expect(stripTags("<p>One.</p><p>Two.</p>")).toBe("One.\n\nTwo.");
  });

  it("removes script and style content entirely", () => {
    expect(stripTags("<p>Keep</p><script>evil()</script><style>a{}</style>")).toBe("Keep");
  });

  it("does not double-decode an escaped entity into markup", () => {
    // "&amp;lt;" is a literal "&lt;", not a "<".
    const xml = `<rss><channel><item><title>A &amp;lt;b&amp;gt; C</title><link>https://x.com/a</link></item></channel></rss>`;
    expect(parseFeed(xml)[0].title).toBe("A &lt;b&gt; C");
  });
});
