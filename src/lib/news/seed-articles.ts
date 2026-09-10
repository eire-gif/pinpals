import type { Article } from "./articles";

/**
 * The first three Pinpals News articles.
 *
 * Each was drafted from a single official press release, then validated:
 * every quote below appears word-for-word in its source release, and no
 * sentence runs more than 25 consecutive words from the source outside a
 * marked quote. No image is attached to any of them, because Pinpals holds no
 * image rights with any source yet — see `docs/specs/news-pipeline.md` §4.
 *
 * This file is temporary scaffolding. It goes away when the `articles` table
 * lands and `listPublishedArticles()` starts querying Supabase.
 */
export const SEED_ARTICLES: Article[] = [
  {
    id: "a1",
    slug: "junior-ryder-cup-returns-to-ireland-2027",
    headline: "Junior Ryder Cup returns to Ireland with Gallacher as captain",
    standfirst:
      "Ballyneety and Adare Manor will host the 2027 matches, with Stephen Gallacher leading Europe for a record third time.",
    bodyMd: [
      "Ballyneety Golf Club will stage two days of international team golf next September. The Confederation of Professional Golf has confirmed Stephen Gallacher as European Captain for the 2027 Junior Ryder Cup, with matches running from 14 to 16 September and the closing singles moving to Adare Manor on the eve of the Ryder Cup itself.",
      "For Gallacher it is a third captaincy, a European record. He led the side in Rome in 2023, where Europe won by 11 points and ended a 17-year wait, and again in New York last year, where the United States took the trophy by 17 and a half points to 12 and a half. A second win would put him alongside Macarena Campomanes and Andy Ingram as the only captains to manage it.",
      "Each team is made up of twelve players, six boys and six girls. The event has run since 1997, and its alumni list is the reason clubs pay attention. Rory McIlroy, Nicolai Højgaard and Nicolas Colsaerts all played in it before going on to win Ryder Cups. Leona Maguire represented Europe in 2008 and has since taken 8.5 points from three Solheim Cup appearances.",
      "Gallacher, 51, won four DP World Tour titles and played under Paul McGinley at Gleneagles in 2014. He set up a foundation supporting junior golf in Scotland and received an MBE in 2024.",
    ].join("\n\n"),
    irishAngle:
      "Two of the three days are at Ballyneety, a members' club rather than a resort course, which is unusual for an event of this level. Any Irish junior in a club programme now has a home tie to aim at, and Maguire's route from the 2008 team is the example.",
    sourceAttribution: "Confederation of Professional Golf, 25 June 2026",
    sourceOrganisation: "Confederation of Professional Golf",
    sourceUrl:
      "https://cpg.golf/news/ryder-cup/stephen-gallacher-named-2027-european-junior-ryder-cup-captain/",
    quotes: [
      {
        text: "The Junior Ryder Cup returning to the Island of Ireland for the first time since 2002 is extremely exciting.",
        speaker: "Stephen Gallacher, 2027 European Junior Ryder Cup Captain",
      },
    ],
    publishMode: "review",
    publishedAt: "2026-09-10T08:00:00+01:00",
    updatedAt: "2026-09-10T08:00:00+01:00",
    correctionNote: null,
    reviewerName: null,
    images: [],
  },
  {
    id: "a2",
    slug: "molinari-vice-captain-2027-ryder-cup-adare-manor",
    headline: "Molinari returns as vice captain for Adare Manor",
    standfirst:
      "Luke Donald has named the Italian as his first vice captain for 2027, a role he has held at the last two Ryder Cups.",
    bodyMd: [
      "Luke Donald has appointed Edoardo Molinari as his first vice captain for the 2027 Ryder Cup, to be played at Adare Manor in Limerick from 13 to 19 September 2027. It is the third Ryder Cup running in which Molinari has held the role, after European wins at Marco Simone in 2023 and Bethpage last year.",
      "The job is a specific one. Molinari, 45, supplies statistical support to Donald and the team through his own analysis model, work that feeds into the qualification system as much as the week itself.",
      "He played in the 2010 Ryder Cup in Wales alongside his brother Francesco, the pair becoming the first brothers to face the United States since Bernard and Geoffrey Hunt in 1963. They halved their fourballs against Stewart Cink and Matt Kuchar, and Edoardo took a half point from his singles with Rickie Fowler as Europe won by a single point. He has three DP World Tour wins, was Challenge Tour Number One in 2009, and won the US Amateur in 2005.",
      "Donald was direct about why the appointment was straightforward, calling Molinari a major factor in the backroom team.",
      "The 2027 matches mark the 100th anniversary of the Ryder Cup.",
    ].join("\n\n"),
    irishAngle:
      "The home team gets to set up the course, and Donald has said explicitly that this is an edge Molinari looks at. How Adare Manor is presented in September 2027 will be a deliberate decision, and it is the kind of detail worth watching for anyone who follows course setup at their own club.",
    sourceAttribution: "Confederation of Professional Golf, 2 April 2026",
    sourceOrganisation: "Confederation of Professional Golf",
    sourceUrl:
      "https://cpg.golf/news/ryder-cup/edoardo-molinari-named-vice-captain-for-the-2027-ryder-cup/",
    quotes: [
      {
        text: "Every time we play in an Irish Open or anything really in Ireland, they're always very passionate, very loud.",
        speaker: "Edoardo Molinari, 2027 European Ryder Cup Vice Captain",
      },
      {
        text: "Edoardo has been a rock of support to me.",
        speaker: "Luke Donald, European Ryder Cup Captain",
      },
    ],
    publishMode: "review",
    publishedAt: "2026-09-10T08:05:00+01:00",
    updatedAt: "2026-09-10T08:05:00+01:00",
    correctionNote: null,
    reviewerName: null,
    images: [],
  },
  {
    id: "a3",
    slug: "incremental-play-womens-golf-retention-research",
    headline: "Research puts a number on women's golf retention",
    standfirst:
      "A webinar attended by Golf Ireland heard that incremental play lifts weekly participation among women by 54 per cent.",
    bodyMd: [
      "A survey of 419 women who had been through the Operation 36 programme in the United States and Canada found that introducing incremental play raised the number playing and practising weekly by 54 per cent. The figure was presented at a Golf Genius webinar attended by 267 people from 21 countries.",
      "Golf Ireland was among the governing bodies represented, alongside The R&A, Scottish Golf, England Golf, Golf Australia and the Japan Golf Association. So were 132 golf clubs. The panel included Molly Moore and Alistair Spink of love.golf, Matt Reagan of Operation 36 and Mark Smith of Stamford Golf Club, who between them have helped create 240,000 new participants worldwide, 96,000 of them women and girls.",
      "The more uncomfortable numbers came from a live poll of the people watching. Just under half said their organisation had a target for increasing female participation. Twenty-three per cent said they ran no women's or girls' programmes at all. Forty-four per cent were tracking whatever they did run on manual workflows, with only five per cent using a dedicated participation dashboard.",
      "The session covered three themes: the part experiences play in building a habit, the coach as the anchor of a community, and how incremental learning drives retention.",
    ].join("\n\n"),
    irishAngle:
      "The 23 per cent figure is the one to sit with. If roughly one in four organisations at a webinar about women's golf runs no programme for women, the number across clubs that did not attend is unlikely to be better. It is a fair question to put to your own committee.",
    sourceAttribution: "Confederation of Professional Golf, 27 August 2026",
    sourceOrganisation: "Confederation of Professional Golf",
    sourceUrl:
      "https://cpg.golf/news/golf-genius-webinar-highlights-opportunity-for-industry-to-build-on-rise-in-girls-and-womens-golf/",
    quotes: [
      {
        text: "If golf is going to grow sustainably, we need to create great experiences that attract more women and girls and give them reasons to keep coming back.",
        speaker: "Aston Ward, Chief Operating Officer, Confederation of Professional Golf",
      },
    ],
    publishMode: "review",
    publishedAt: "2026-09-10T08:10:00+01:00",
    updatedAt: "2026-09-10T08:10:00+01:00",
    correctionNote: null,
    reviewerName: null,
    images: [],
  },
];
