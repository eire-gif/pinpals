import type { LegalDocument } from "./types";
import { OPERATOR } from "./operator";

/**
 * Community & Tee-Time Guidelines, v1.0.
 *
 * The safety document. Pinpals' whole proposition is that strangers who
 * met online then meet in person at a golf course, and pretending
 * otherwise in the paperwork would be both dishonest and, if something
 * ever went wrong, considerably worse for Pinpals than saying it plainly.
 *
 * So this document does three things a disclaimer alone cannot:
 *  - it states, in the member's own reading, that Pinpals does not vet
 *    anyone (which is what makes the same statement in the Terms fair
 *    rather than buried);
 *  - it gives genuinely useful safety advice, because a platform that has
 *    thought about the risk is in a far better position than one that has
 *    only excluded it;
 *  - it tells members how to report, which is the mechanism that actually
 *    reduces harm.
 */
export const COMMUNITY_GUIDELINES: LegalDocument = {
  slug: "community-guidelines",
  consentType: "community_guidelines",
  title: "Pinpals Community & Tee-Time Guidelines",
  shortTitle: "Community Guidelines",
  version: "1.0",
  effectiveFrom: "2026-09-10",
  summary: "How members treat each other, and how to stay safe meeting someone new for a round.",
  keyPoints: [
    "We don't vet members. Nobody here has been background-checked, including the person you're about to play with.",
    "Meet at the clubhouse, tell someone where you're going, and travel separately the first time.",
    "Be who you say you are — false handicaps, false clubs and false names all end accounts.",
    "Turn up, or cancel early. Somebody held a tee time for you.",
    "Report anything that feels wrong. We'd much rather hear it than not.",
  ],
  sections: [
    {
      id: "no-vetting",
      heading: "1. What we do and don't check",
      blocks: [
        {
          kind: "note",
          text: "Pinpals does not vet, screen or background-check its members. We do not verify identities, handicaps, club memberships or union numbers. Anyone can create an account with an email address. Please read the rest of this section with that in mind.",
        },
        {
          kind: "p",
          text: "What we do have: a report option on every profile, listing and conversation; a record of behaviour across accounts; and staff who read reports and act on them. That is a way of dealing with problems, not a guarantee against them.",
        },
      ],
    },
    {
      id: "meeting-safely",
      heading: "2. Meeting someone for the first time",
      blocks: [
        {
          kind: "p",
          text: "Golf has a real advantage here: you are meeting at a staffed, public venue in daylight. Keep that advantage.",
        },
        {
          kind: "ul",
          items: [
            "Meet at the clubhouse or the pro shop, not in a car park and not somewhere off the course.",
            "Tell someone you trust where you are playing, with whom, and when you expect to be finished.",
            "Travel separately the first time you play with someone. Do not share a lift, and do not give a home address.",
            "Keep the conversation on Pinpals until you have played together. It is where a record exists if you ever need one.",
            "Bring your own clubs, water and phone, and keep the phone with you.",
            "If something feels wrong, leave. You never owe anyone a round of golf, and you do not need to explain yourself.",
          ],
        },
        {
          kind: "p",
          text: "Selling in person deserves the same care: meet at the club, in daylight, with someone else around. Never invite a buyer to your home, and never go alone to a seller's.",
        },
      ],
    },
    {
      id: "honesty",
      heading: "3. Be who you say you are",
      blocks: [
        {
          kind: "p",
          text: "Use your real name and a recent photograph of yourself. An accurate handicap matters more here than anywhere — a fourball works when everyone's expectations match, and a made-up index spoils it for three other people.",
        },
        {
          kind: "p",
          text: "Do not claim membership of a club you do not belong to, and do not create a second account to get around a restriction on your first.",
        },
      ],
    },
    {
      id: "turning-up",
      heading: "4. Turning up",
      blocks: [
        {
          kind: "p",
          text: "When you accept a tee time, somebody has held a place for you and possibly paid for it. If you cannot make it, say so as early as you can, through Pinpals, so the place can be filled.",
        },
        {
          kind: "p",
          text: "Be clear in advance about who is booking, what the green fee is, and how it is being paid. Pinpals does not handle any of it, and \"I assumed it was covered\" is the most common way a good arrangement goes wrong.",
        },
        {
          kind: "p",
          text: "Repeated no-shows are visible to us, and they are grounds for restricting an account.",
        },
      ],
    },
    {
      id: "on-the-course",
      heading: "5. On the course",
      blocks: [
        {
          kind: "p",
          text: "The club's rules are the rules: dress code, pace of play, buggy policy, visitor conditions. Check them before you travel — they vary far more than people expect, and the club will not make an exception because you arranged it on Pinpals.",
        },
        {
          kind: "p",
          text: "Play at a sensible pace, look after the course, and be the kind of playing partner you would want to be drawn with.",
        },
      ],
    },
    {
      id: "treating-each-other",
      heading: "6. Treating each other well",
      blocks: [
        {
          kind: "p",
          text: "Pinpals is meant to be a friendly place for golfers of every standard. Beginners, high handicaps, returning players and anyone nervous about walking into a strange club are exactly who this is for.",
        },
        { kind: "p", text: "Not acceptable, at any point:" },
        {
          kind: "ul",
          items: [
            "harassment, threats, intimidation, or repeated contact after someone has asked you to stop;",
            "abuse or discrimination on any grounds, including sex, age, race, disability, religion or sexual orientation;",
            "sexual content, or approaching another member romantically after they have made clear they are not interested — Pinpals is not a dating site;",
            "sharing another member's personal information, screenshots or photographs without their agreement;",
            "using anything you learn through Pinpals to market to someone.",
          ],
        },
      ],
    },
    {
      id: "reporting",
      heading: "7. Reporting a problem",
      blocks: [
        {
          kind: "p",
          text: "Every profile, listing and conversation has a report option. Use it. A report takes a moment, it goes to our staff, and it is kept with that member's record even if we take no action immediately — patterns are usually what make a problem visible.",
        },
        {
          kind: "p",
          text: `You can also write to ${OPERATOR.complaintsContact} if you would rather not report in-app, or if it concerns something that happened away from the site.`,
        },
        {
          kind: "note",
          text: "If you are ever in immediate danger, contact the Gardaí on 999 or 112 first. Tell us afterwards — we will help however we can, including preserving records — but your safety comes before our process.",
        },
        {
          kind: "p",
          text: "Reporting someone in good faith will never count against you, even if we decide no action is needed. Deliberately false reports will.",
        },
      ],
    },
  ],
};
