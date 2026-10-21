/**
 * The PinPals advert (Oct 2026): a 60-second film of the whole app, built
 * from real app screens, used on /tour and the home page. Start times are
 * seconds into TOUR_VIDEO — keep them in step with the film if it is re-cut.
 */
export type TourScene = { title: string; start: number };
export type TourChapter = { title: string; blurb: string; scenes: TourScene[] };

export const TOUR_VIDEO = "/videos/pinpals-advert-60.mp4";
export const TOUR_POSTER = "/videos/pinpals-advert-poster.jpg";

export const TOUR_CHAPTERS: TourChapter[] = [
  {
    title: "Find a game",
    blurb: "Golfers near you, your crew's chat, and live scoring together.",
    scenes: [
      { title: "Golf just got better", start: 0 },
      { title: "Find your fourball", start: 3 },
      { title: "Your crew, your chat", start: 6.6 },
      { title: "Score it live", start: 10.2 },
    ],
  },
  {
    title: "On the course",
    blurb: "Hole maps and yardage, lie help, lock-screen scoring and your watch.",
    scenes: [
      { title: "Every hole, every yard", start: 13.8 },
      { title: "Tricky lie? Sorted", start: 17.4 },
      { title: "Score without unlocking", start: 21 },
      { title: "Score from your wrist", start: 24.6 },
    ],
  },
  {
    title: "Society day",
    blurb: "Run the society, the clubhouse TV and fair results in seconds.",
    scenes: [
      { title: "Run your society", start: 28.2 },
      { title: "Live in the bar", start: 31.8 },
      { title: "Results in seconds", start: 35.4 },
    ],
  },
  {
    title: "Off the course",
    blurb: "Let them follow along, plan the trip, rate your club and sell your old gear.",
    scenes: [
      { title: "Let them follow along", start: 39 },
      { title: "Plan the trip", start: 42.6 },
      { title: "Rate your club", start: 46.2 },
      { title: "Sell your old clubs", start: 49.8 },
      { title: "Golf is better on PinPals", start: 53.4 },
    ],
  },
];
