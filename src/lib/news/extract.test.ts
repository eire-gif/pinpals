import { describe, it, expect } from "vitest";
import { extractArticle, articleBodyFromJsonLd, extractTitle } from "./extract";
import { validateDraft, sourceIsDraftable } from "./validate";

/**
 * A news page shaped the way news pages are: chrome above, article in the
 * middle, related stories and a sponsor footer below. The related-story
 * teasers are the trap — they are prose, they are long enough, and a naive
 * "collect every paragraph" extractor takes them all.
 */
const PAGE = `<!doctype html>
<html><head><title>Harrington named Vice Captain</title></head>
<body>
  <header>
    <nav><p>Home</p><p><a href="/tickets">Tickets and hospitality for the 2027 match at Adare Manor</a></p></nav>
  </header>
  <div class="cookie-banner">
    <p>We use cookies to improve your experience on this website. Accept cookies to continue browsing our content.</p>
  </div>
  <main>
    <article>
      <p>P&#225;draig Harrington has been named as a Vice Captain for the 2027 Ryder Cup at Adare Manor, joining a backroom team that will be confirmed in full next spring.</p>
      <p>The three-time Major winner captained Europe at Whistling Straits in 2021 and has played on six Ryder Cup teams, winning four of them.</p>
      <blockquote><p>&#8220;To be involved in a Ryder Cup in my own country is something I could not turn down,&#8221; Harrington said.</p></blockquote>
      <p>Donald said the appointment was straightforward. &#8220;Nobody knows more about what this week asks of a player,&#8221; he said.</p>
      <p>The match will be played at Adare Manor in County Limerick from 13-19 September 2027, the hundredth anniversary of the first contest.</p>
    </article>
    <aside>
      <p>Related: Europe名 squad news and every qualifying event on the road to Adare Manor this season.</p>
    </aside>
  </main>
  <section class="related">
    <p><a href="/a">Tickets for the 2027 Ryder Cup sold out within hours of going on general sale this morning</a></p>
    <p>Read more</p>
  </section>
  <footer>
    <p>&#169; Ryder Cup Europe. All rights reserved. Privacy policy and terms of use apply to this site.</p>
  </footer>
</body></html>`;

describe("extractArticle", () => {
  it("returns the article paragraphs and nothing else", () => {
    const result = extractArticle(PAGE)!;
    expect(result).not.toBeNull();

    expect(result.text).toContain("named as a Vice Captain");
    expect(result.text).toContain("hundredth anniversary");

    // The furniture.
    expect(result.text).not.toMatch(/cookies/i);
    expect(result.text).not.toMatch(/all rights reserved/i);
    expect(result.text).not.toMatch(/sold out within hours/i);
    expect(result.text).not.toMatch(/Tickets and hospitality/i);
  });

  it("prefers the semantic container when the page has one", () => {
    expect(extractArticle(PAGE)!.method).toBe("article-element");
  });

  it("separates paragraphs so the text reads as prose", () => {
    const result = extractArticle(PAGE)!;
    expect(result.paragraphs).toBe(5);
    expect(result.text.split("\n\n")).toHaveLength(5);
  });

  it("keeps quotation marks intact so quote verification can work", () => {
    // This is the whole point of the extractor for our purposes: a draft's
    // quotes are checked word-for-word against this text. Mangling the
    // punctuation here would fail genuine drafts.
    const raw = extractArticle(PAGE)!.text;

    const result = validateDraft(
      {
        headline: "Harrington named Vice Captain for 2027",
        standfirst: "The Dubliner joins Luke Donald's backroom team for the match at Adare Manor.",
        body_md: Array(160).fill("word").join(" "),
        irish_angle: "The match is in County Limerick.",
        quotes: [
          {
            text: "To be involved in a Ryder Cup in my own country is something I could not turn down,",
            speaker: "Pádraig Harrington",
          },
          {
            text: "Nobody knows more about what this week asks of a player",
            speaker: "Luke Donald",
          },
        ],
        source_attribution: "Ryder Cup Europe, 29 July 2026",
      },
      raw,
    );

    expect(result.verifiedQuotes).toBe(2);
    expect(result.errors.filter((e) => e.includes("FABRICATED"))).toEqual([]);
  });

  it("produces text the drafting gate accepts", () => {
    const raw = extractArticle(PAGE)!.text;
    expect(sourceIsDraftable(raw, "Harrington named Vice Captain").ok).toBe(true);
  });

  it("prefers JSON-LD articleBody over the heuristics", () => {
    const withSchema = PAGE.replace(
      "<main>",
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: "Harrington named Vice Captain",
        articleBody:
          "The publisher's own text, which is long enough to be preferred over the paragraph heuristics and says exactly what the article says without any of the surrounding furniture at all.",
      })}</script><main>`,
    );
    const result = extractArticle(withSchema)!;
    expect(result.method).toBe("json-ld");
    expect(result.text).toContain("The publisher's own text");
  });

  it("ignores broken JSON-LD rather than failing the page", () => {
    const withBroken = PAGE.replace(
      "<main>",
      `<script type="application/ld+json">{ this is not json }</script><main>`,
    );
    const result = extractArticle(withBroken)!;
    expect(result.method).toBe("article-element");
    expect(result.text).toContain("named as a Vice Captain");
  });

  it("ignores a JSON-LD articleBody too short to be an article", () => {
    const stub = PAGE.replace(
      "<main>",
      `<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Short."}</script><main>`,
    );
    expect(extractArticle(stub)!.method).toBe("article-element");
  });

  it("falls back to paragraph density when there is no semantic container", () => {
    const soup = PAGE.replace(/<\/?(main|article|aside)[^>]*>/g, "");
    const result = extractArticle(soup)!;
    expect(result.method).toBe("density");
    expect(result.text).toContain("named as a Vice Captain");
    expect(result.text).not.toMatch(/all rights reserved/i);
  });

  it("drops a block that is mostly link text", () => {
    const linky = `<article>
      <p>${"padding ".repeat(10)}<a href="/x">${"link text ".repeat(20)}</a></p>
      <p>This is a real paragraph of article prose that runs on for long enough to be kept by the length test.</p>
      <p>And a second real paragraph, also comfortably past the minimum length this extractor insists on.</p>
    </article>`;
    const result = extractArticle(linky)!;
    expect(result.paragraphs).toBe(2);
    expect(result.text).not.toContain("link text");
  });

  it("removes duplicate blocks, which pull quotes create", () => {
    const dupes = `<article>
      <p>Harrington said the chance to be involved in a home Ryder Cup was impossible to turn down this time.</p>
      <blockquote><p>Harrington said the chance to be involved in a home Ryder Cup was impossible to turn down this time.</p></blockquote>
      <p>The match will be played at Adare Manor in County Limerick over five days in September 2027.</p>
    </article>`;
    expect(extractArticle(dupes)!.paragraphs).toBe(2);
  });

  it("returns null for a page with no article text", () => {
    expect(extractArticle("<html><body><nav><p>Home</p></nav></body></html>")).toBeNull();
    expect(extractArticle("")).toBeNull();
    expect(extractArticle("   ")).toBeNull();
  });

  it("reports reduced confidence when article-shaped prose sits outside the run", () => {
    // Three article paragraphs, a rail of short blocks wide enough to end the
    // run, then three related-story standfirsts. The extractor should return
    // one of the two groups and say it only accounts for about half the
    // prose on the page — which is the signal the collector flags on.
    const para = (n: number) =>
      `<p>Paragraph number ${n}, written at a length that clears the minimum comfortably and reads like ordinary article prose.</p>`;
    const short = `<p>More</p>`;

    const listing = `<main>
      ${para(1)}${para(2)}${para(3)}
      ${short.repeat(6)}
      ${para(4)}${para(5)}${para(6)}
    </main>`;

    const result = extractArticle(listing)!;
    expect(result.paragraphs).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("reports full confidence for a page that is only its article", () => {
    expect(extractArticle(PAGE)!.confidence).toBe(1);
  });
});

/**
 * Modelled on Ryder Cup Europe's real markup, captured from a live page after
 * the first collection run returned nothing at all.
 *
 * Two traps, both of which the first version walked straight into:
 *
 *   1. The page's <article> elements are the related-story CARDS in the rail,
 *      not the article. Each is a thumbnail and an <h3>, with no <p> in it.
 *      The body sits outside all of them.
 *   2. A sponsor carousel renders as one <p> of about nineteen thousand
 *      characters. It contains no links, so link density does not catch it,
 *      and by character weight it outweighs the real article many times over.
 */
const RYDERCUP_SHAPED = `<!DOCTYPE html><html lang="en"><head>
  <title>Luke Donald leads praise for Great Britain and Ireland's comeback Walker Cup victory</title>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Luke Donald leads praise","datePublished":"2026-09-07T11:42:00.000Z","author":{"@type":"Person","name":"Ryder Cup Digital"}}</script>
</head><body>
  <div class="PageLayout-module__root">
    <div class="InfoBar-module__dateLocation"><span>September 13-19, 2027</span><span>Adare Manor, Limerick, Ireland</span></div>

    <h1>Luke Donald leads praise for Great Britain and Ireland's comeback Walker Cup victory</h1>

    <p class="NewsArticleContentSegment-module__paragraph">Three points behind, GB&amp;I faced a deficit no team had ever overturned to win the Walker Cup, against a United States side carrying seven of the top ten players in the World Amateur Golf Ranking.</p>
    <p class="NewsArticleContentSegment-module__paragraph">But with six players who had returned from the team beaten at Cypress Point in 2025, experience paid off, in a comeback Paul McGinley likened to &#x201C;the Miracle at Medinah&quot;.</p>
    <div data-ad-slot="" class="AdSlot-module__container"><div class="AdSlot-module__adSlot" id="_R_25b9_"></div></div>
    <p class="NewsArticleContentSegment-module__paragraph">Fuelled by early momentum in the singles, England&#x27;s Jack Whaley set the tone, six under par through 11 holes to defeat World Number Five William Jennings 8&amp;7.</p>
    <p class="NewsArticleContentSegment-module__paragraph">The victory was confirmed in the afternoon, and attention now turns to Adare Manor in County Limerick, where the Ryder Cup itself will be played in September 2027.</p>

    <p class="PartnerCarousel-module__strip">${"Worldwide Partner 2027 Ryder Cup".repeat(600)}</p>

    <ul>
      <li><div data-card-type="article" class="NewsCard-module__card">
        <article class="NewsCard-module__contentWrapper"><div class="NewsCard-module__content">
          <span class="NewsCard-module__eyebrow">a day ago</span>
          <a class="NewsCard-module__title" href="/news-media/united-states-announces-selection-criteria-for-2027-ryder-cup"><h3>United States Announces Selection Criteria for 2027 Ryder Cup</h3></a>
        </div></article></div></li>
      <li><div data-card-type="article" class="NewsCard-module__card">
        <article class="NewsCard-module__contentWrapper"><div class="NewsCard-module__content">
          <span class="NewsCard-module__eyebrow">2 days ago</span>
          <a class="NewsCard-module__title" href="/news-media/qashio-named-official-supporter-of-the-2027-ryder-cup"><h3>Qashio named Official Supporter of the 2027 Ryder Cup</h3></a>
        </div></article></div></li>
    </ul>
  </div>
</body></html>`;

describe("extractArticle on Ryder Cup Europe's real page shape", () => {
  it("finds the body even though every <article> on the page is a teaser card", () => {
    const result = extractArticle(RYDERCUP_SHAPED);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Three points behind");
    expect(result!.text).toContain("Adare Manor");
    expect(result!.paragraphs).toBe(4);
  });

  it("does not scope to a teaser card that holds no article text", () => {
    // The regression. Preferring the largest <article> found a card with no
    // paragraphs in it and returned null for every item collected.
    expect(extractArticle(RYDERCUP_SHAPED)!.method).toBe("density");
  });

  it("leaves the sponsor carousel out, despite it being the longest block", () => {
    const text = extractArticle(RYDERCUP_SHAPED)!.text;
    expect(text).not.toMatch(/Worldwide Partner/);
    expect(text.length).toBeLessThan(2_000);
  });

  it("keeps the related-story headlines out of the body", () => {
    const text = extractArticle(RYDERCUP_SHAPED)!.text;
    expect(text).not.toMatch(/Selection Criteria/);
    expect(text).not.toMatch(/Qashio/);
  });

  it("decodes the entities the page uses, so quotes verify verbatim", () => {
    const text = extractArticle(RYDERCUP_SHAPED)!.text;
    expect(text).toContain("GB&I");
    expect(text).toContain("England's Jack Whaley");
    expect(text).toContain("8&7");

    // The page really does open that quote with a curly mark and close it
    // with a straight one. The extractor preserves the mixture rather than
    // tidying it, which is the right call: validate.ts folds curly and
    // straight quotes together before comparing, so verification still
    // matches, and raw_body stays a faithful record of what was published.
    expect(text).toContain('“the Miracle at Medinah"');
  });

  it("yields text the drafting gate accepts", () => {
    const text = extractArticle(RYDERCUP_SHAPED)!.text;
    const verdict = sourceIsDraftable(
      text,
      "Luke Donald leads praise for Great Britain and Ireland's comeback Walker Cup victory",
    );
    expect(verdict.ok).toBe(true);
  });

  it("takes its headline from the h1, not the tab title", () => {
    expect(extractTitle(RYDERCUP_SHAPED)).toBe(
      "Luke Donald leads praise for Great Britain and Ireland's comeback Walker Cup victory",
    );
  });
});

describe("extractTitle", () => {
  it("prefers the h1 over the tab title, which carries the site name", () => {
    const html = `<html><head><title>Harrington named Vice Captain | Ryder Cup Europe</title></head>
      <body><h1>Harrington named Vice Captain</h1></body></html>`;
    expect(extractTitle(html)).toBe("Harrington named Vice Captain");
  });

  it("falls back to og:title when there is no h1", () => {
    const html = `<html><head>
      <meta property="og:title" content="Harrington named Vice Captain" />
      <title>Something | Site</title></head><body></body></html>`;
    expect(extractTitle(html)).toBe("Harrington named Vice Captain");
  });

  it("falls back to the tab title last", () => {
    const html = `<html><head><title>Harrington named Vice Captain</title></head><body></body></html>`;
    expect(extractTitle(html)).toBe("Harrington named Vice Captain");
  });

  it("decodes entities in the headline", () => {
    expect(extractTitle("<h1>P&#225;draig Harrington &amp; Luke Donald</h1>")).toBe(
      "Pádraig Harrington & Luke Donald",
    );
  });

  it("returns null when the page has no headline at all", () => {
    expect(extractTitle("<html><body><p>text</p></body></html>")).toBeNull();
    expect(extractTitle("<h1></h1>")).toBeNull();
  });
});

describe("articleBodyFromJsonLd", () => {
  it("finds articleBody nested inside @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "WebSite", name: "Ryder Cup" },
        { "@type": "NewsArticle", articleBody: "The body, nested one level down inside a graph array." },
      ],
    })}</script>`;
    expect(articleBodyFromJsonLd(html)).toContain("nested one level down");
  });

  it("takes the longest where a page declares several", () => {
    const html = `
      <script type="application/ld+json">{"@type":"NewsArticle","articleBody":"Short one."}</script>
      <script type="application/ld+json">{"@type":"NewsArticle","articleBody":"A considerably longer body which is the one that should win."}</script>`;
    expect(articleBodyFromJsonLd(html)).toContain("considerably longer");
  });

  it("returns null when there is none", () => {
    expect(articleBodyFromJsonLd("<html><body><p>Hello</p></body></html>")).toBeNull();
  });
});
