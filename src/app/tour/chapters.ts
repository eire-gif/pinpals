/**
 * The PinPals tour film (Oct 2026): 19 scenes in four chapters, built from
 * real app screens. Start times are seconds into /videos/pinpals-tour.mp4 —
 * keep them in step with the film if it is re-cut.
 */
export type TourScene = { title: string; start: number };
export type TourChapter = { title: string; blurb: string; scenes: TourScene[] };

export const TOUR_VIDEO = "/videos/pinpals-tour.mp4";
export const TOUR_POSTER = "/videos/pinpals-tour-poster.jpg";

export const TOUR_CHAPTERS: TourChapter[] = [
  {
    title: "Find a game",
    blurb: "Golfers near you, spare tee times, your groups and live scoring together.",
    scenes: [
      { title: "Welcome to PinPals", start: 0 },
      { title: "Find golfers & tee times", start: 8 },
      { title: "Groups & chat", start: 18 },
      { title: "Live scoring with friends", start: 27 },
    ],
  },
  {
    title: "On the course",
    blurb: "Hole maps, weather, club picks, lie help, voice scoring, watches and widgets.",
    scenes: [
      { title: "Every hole from the sky", start: 39 },
      { title: "Weather, wind & club pick", start: 49 },
      { title: "Help with the lie", start: 58 },
      { title: "Say it, or score from the lock screen", start: 67 },
      { title: "On your wrist", start: 76 },
      { title: "Home-screen widgets", start: 84 },
    ],
  },
  {
    title: "Society day",
    blurb: "Run the society, the control room, the clubhouse TV and fair results.",
    scenes: [
      { title: "Run your society", start: 91 },
      { title: "The secretary’s control room", start: 102 },
      { title: "Live on the clubhouse TV", start: 111 },
      { title: "Certified cards & results", start: 119 },
    ],
  },
  {
    title: "Off the course",
    blurb: "Share your round, plan the trip, rate your club and sell your old gear.",
    scenes: [
      { title: "Share your round", start: 129 },
      { title: "Trips away", start: 137 },
      { title: "Rate your local club", start: 146 },
      { title: "Marketplace", start: 154 },
      { title: "Golf is better on PinPals", start: 164 },
    ],
  },
];
