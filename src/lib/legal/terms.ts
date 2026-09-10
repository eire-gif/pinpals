import type { LegalDocument } from "./types";
import { OPERATOR, operatorFullDescription } from "./operator";

/**
 * Pinpals Terms of Service, v1.0.
 *
 * ============ Read this before editing ============
 *
 * This document is drafted on the "facilitator" position settled in
 * claude/stripe-connect-business-model-decision.md: in a marketplace sale
 * the contract is between the two members, and Pinpals introduces them and
 * processes the payment for a commission. Almost every clause below
 * depends on that. If Pinpals ever becomes the merchant of record, this is
 * not a wording tweak — sections `role`, `marketplace`, `payments` and
 * `liability` all have to be rewritten, and consumer-rights obligations
 * (14-day cooling off, conformity guarantees, returns) attach to Pinpals
 * directly.
 *
 * One thing this document deliberately does NOT try to do: exclude
 * everything. Under the Consumer Rights Act 2022 and S.I. No. 27/1995, a
 * term in a consumer contract that is unfair is not merely unenforceable —
 * it is void, and a liability clause that reads as though it excludes
 * death, personal injury or fraud tends to take the enforceable parts of
 * the same clause down with it. The carve-out in `liability` is therefore
 * load-bearing, not boilerplate. Removing it would make this document
 * protect Pinpals LESS, not more.
 *
 * This has not been reviewed by a solicitor. It should be, before launch.
 */
export const TERMS: LegalDocument = {
  slug: "terms",
  consentType: "terms",
  title: "Pinpals Terms of Service",
  shortTitle: "Terms of Service",
  version: "1.0",
  effectiveFrom: "2026-09-10",
  summary: "The agreement between you and Pinpals when you use the site.",
  keyPoints: [
    "Pinpals introduces golfers to each other. It doesn't run the golf, and it isn't the seller in a marketplace sale.",
    "You need to be 18 or over, and everything you tell us about yourself needs to be true.",
    "Tee-time arrangements are between you and the other golfers — green fees, club rules and turning up are your responsibility.",
    "When you sell, you're the seller. Pinpals takes a commission and handles the payment.",
    "We don't vet members, verify handicaps or check that clubs are genuine. Use your judgement, and meet people at the club.",
    "Nothing here takes away rights the law gives you as a consumer, and nothing here limits our liability for personal injury or fraud.",
  ],
  sections: [
    {
      id: "who-we-are",
      heading: "1. Who we are and how to reach us",
      blocks: [
        {
          kind: "p",
          text: `Pinpals is operated by ${operatorFullDescription()}. In these Terms, "Pinpals", "we", "us" and "our" mean that operator, and "you" means the person using the site.`,
        },
        {
          kind: "p",
          text: `General enquiries: ${OPERATOR.generalEmail}. Complaints about a sale, a member or a tee time: ${OPERATOR.complaintsContact}. Data protection requests: ${OPERATOR.dataProtectionContact}.`,
        },
        {
          kind: "p",
          text: "These Terms, together with the Marketplace Rules, the Community & Tee-Time Guidelines and the Privacy Policy, form the agreement between you and us. If anything in the Marketplace Rules or the Guidelines conflicts with these Terms, these Terms take precedence.",
        },
      ],
    },
    {
      id: "eligibility",
      heading: "2. Who can join",
      blocks: [
        {
          kind: "p",
          text: "You must be at least 18 years old to hold a Pinpals account. You confirm this when you sign up. We do not verify age, and we rely on that confirmation.",
        },
        {
          kind: "p",
          text: "You may hold one account. It is personal to you — you may not share your login, and you may not create an account on someone else's behalf or under a name that is not yours.",
        },
        {
          kind: "p",
          text: "You are responsible for keeping your password secure and for everything done through your account. Tell us promptly if you think someone else has access to it.",
        },
        {
          kind: "p",
          text: "If we have suspended or closed your account, you may not open another one without our agreement.",
        },
      ],
    },
    {
      id: "role",
      heading: "3. What Pinpals is — and what it is not",
      blocks: [
        {
          kind: "p",
          text: "Pinpals is a platform that lets golfers find each other, arrange to play together, and buy and sell golf equipment among themselves. That is the whole of what we do.",
        },
        { kind: "p", text: "In particular, Pinpals is not:" },
        {
          kind: "ul",
          items: [
            "a golf club, course operator, or agent for any club or course;",
            "a booking agent — we do not reserve tee times, hold green fees, or have any arrangement with the clubs listed in our course directory;",
            "the seller, buyer or owner of anything listed in the marketplace;",
            "an escrow service, a bank, or a provider of any regulated financial service;",
            "an insurer, or a provider of any cover for you, your equipment or your play;",
            "a golfing union or handicapping authority.",
          ],
        },
        {
          kind: "note",
          text: "We do not vet, screen, background-check or verify members. We do not verify handicaps, club memberships, union membership numbers, identities, or that a listed item is genuine, owned by the seller, or as described. Listing a golf club in our directory is not an endorsement by that club of Pinpals, or by Pinpals of that club.",
        },
        {
          kind: "p",
          text: "Anything a member writes — a profile, a listing, a message, a review — is that member's own. We do not check it in advance, and publishing it does not mean we agree with it or vouch for it.",
        },
      ],
    },
    {
      id: "tee-times",
      heading: "4. Tee times and playing together",
      blocks: [
        {
          kind: "p",
          text: "When a member posts availability and another member joins it, the arrangement is between those members. Pinpals records that they agreed; it is not a party to it, and it is not a contract with us.",
        },
        { kind: "p", text: "This means, and you accept, that:" },
        {
          kind: "ul",
          items: [
            "booking the tee time with the club is the members' own responsibility, not ours — posting availability on Pinpals does not reserve anything;",
            "green fees, buggy hire, catering and any other cost are a matter between the members and the club, and we neither collect nor guarantee them;",
            "the club's rules, dress code, pace-of-play policy, handicap requirements and visitor conditions apply, and it is your responsibility to know them;",
            "we are not responsible if another member cancels, does not turn up, arrives late, plays badly, behaves poorly, or turns out not to be who or what their profile suggests;",
            "we are not responsible if a club refuses entry, cancels a booking, closes the course, or is unavailable for any reason.",
          ],
        },
        {
          kind: "note",
          text: "You are meeting people you have not met before. Arrange to meet at the clubhouse, tell someone where you are going, and make your own judgement about who you play with. If a member makes you uncomfortable, report them — every profile and message has a report option, and we would far rather hear about it early.",
        },
        {
          kind: "p",
          text: "You take part in golf, and travel to and from it, at your own risk. Golf carries an inherent risk of injury, and we have no control over any course, its condition, or the conduct of anyone on it.",
        },
      ],
    },
    {
      id: "marketplace",
      heading: "5. Buying and selling",
      blocks: [
        {
          kind: "note",
          text: "When you sell something on Pinpals, you are the seller. The contract of sale is between you and the buyer. Pinpals introduces you, provides the listing and messaging tools, and processes the payment in return for a commission — it does not buy, own, hold, inspect or ship anything.",
        },
        {
          kind: "p",
          text: "The full rules for listings, offers, auctions, delivery and returns are in the Marketplace Rules, which form part of this agreement. In summary:",
        },
        {
          kind: "ul",
          items: [
            "as a seller, you confirm you own what you list and are entitled to sell it, that your description and photographs are accurate and your own, and that the item is genuine;",
            "as a buyer, you are responsible for satisfying yourself about an item before you commit to buy it — ask questions through the messaging tools;",
            "if you sell in the course of a business rather than privately, you are a trader, consumer law applies to your sales, and complying with it is your responsibility, not ours;",
            "counterfeit clubs, stolen goods, and anything you are not lawfully entitled to sell are prohibited outright.",
          ],
        },
        {
          kind: "p",
          text: "We may remove a listing, cancel an order, or suspend an account where we reasonably believe these Terms or the Marketplace Rules have been broken. We are not obliged to monitor listings, and not removing something does not mean we have approved it.",
        },
      ],
    },
    {
      id: "payments",
      heading: "6. Payments, fees and refunds",
      blocks: [
        {
          kind: "p",
          text: "Payments are processed by Stripe. Card details are handled by Stripe and are never seen or stored by Pinpals. Using the marketplace means Stripe's own terms apply to the payment, and a seller receiving payouts must complete Stripe's onboarding and identity checks.",
        },
        {
          kind: "p",
          text: "Pinpals charges the seller a commission on each completed sale. The rate in force is shown before you list and again before a sale completes. We may change it, but a change never applies to a sale already agreed.",
        },
        {
          kind: "p",
          text: "Refunds are handled through the platform so that the money follows the same path back that it took out. Where a refund is due from a seller, we may recover it from that seller's future payouts, from their connected Stripe account, or by invoicing them directly.",
        },
        {
          kind: "note",
          text: "If a buyer raises a chargeback with their card issuer, the amount is debited from Pinpals first, whatever the outcome. Where the chargeback relates to your sale, you are responsible to us for that amount and for any fee charged with it. We may set it against your payouts or recover it from you directly.",
        },
        {
          kind: "p",
          text: "You are responsible for your own tax position on anything you sell. Pinpals does not give tax advice and does not account for tax on your behalf.",
        },
      ],
    },
    {
      id: "disputes",
      heading: "7. Disputes between members",
      blocks: [
        {
          kind: "p",
          text: "If something goes wrong between two members — an item that never arrived, one that is not as described, a tee time that fell apart — the first step is to raise it with the other member through the messaging tools, and then to open a support case.",
        },
        {
          kind: "p",
          text: "We may look at a dispute, ask both members for information, and decide whether to refund, release or hold a payment we are still holding. We do that to keep the platform usable, not because we are an arbitrator: our decision settles what happens to the money on Pinpals, and it does not decide the members' legal rights against each other, which remain a matter between them.",
        },
        {
          kind: "p",
          text: "We are not obliged to become involved in a dispute, to pursue one member on another's behalf, or to compensate a member for another member's conduct.",
        },
      ],
    },
    {
      id: "conduct",
      heading: "8. How you must behave",
      blocks: [
        { kind: "p", text: "You agree not to:" },
        {
          kind: "ul",
          items: [
            "give false information about yourself, your handicap, your club, or anything you list;",
            "harass, threaten, abuse, defame or discriminate against another member, or post content that is unlawful, hateful or obscene;",
            "use Pinpals to advertise a business, a service, or anything other than your own golf equipment, without our written agreement;",
            "take a transaction off-platform in order to avoid commission, after making contact through Pinpals;",
            "scrape, copy, republish or resell any part of the site, including the course directory and the member directory;",
            "use another member's personal information for anything other than the arrangement you are making with them — in particular, never for marketing;",
            "attempt to break, overload, probe or gain unauthorised access to the site;",
            "use automated tools to create accounts, post listings, place bids or send messages.",
          ],
        },
        {
          kind: "p",
          text: "We may remove content, restrict features, suspend or close an account where we reasonably believe this section has been broken, or where we need to in order to protect other members. Where it is reasonable to do so, we will tell you why and give you a way to respond.",
        },
      ],
    },
    {
      id: "content",
      heading: "9. Content you post",
      blocks: [
        {
          kind: "p",
          text: "Anything you post stays yours. By posting it, you give us a non-exclusive, royalty-free licence to host, store, display and reproduce it for the purpose of running and promoting Pinpals, for as long as you keep it on the site.",
        },
        {
          kind: "p",
          text: "You confirm that you own, or have permission to use, everything you post, and that posting it does not infringe anyone else's rights. Do not upload a photograph you did not take, and do not upload a photograph of someone who has not agreed to it.",
        },
        {
          kind: "p",
          text: "The Pinpals name, logo, design and the site itself are ours, and nothing in these Terms gives you the right to use them.",
        },
        {
          kind: "p",
          text: `If you believe something on Pinpals infringes your rights, tell us at ${OPERATOR.complaintsContact} with enough detail to find it, and we will look into it promptly.`,
        },
      ],
    },
    {
      id: "availability",
      heading: "10. The site itself",
      blocks: [
        {
          kind: "p",
          text: "We work to keep Pinpals available and accurate, but we do not promise that it will be uninterrupted, error-free, or that the information on it — including the course directory — is complete or current. Course details, opening arrangements and green fees change, and you should confirm them with the club.",
        },
        {
          kind: "p",
          text: "We may change, suspend or withdraw features, and we may stop offering the service. If we withdraw it altogether we will give you reasonable notice where we can, and we will deal fairly with any money we are holding for you.",
        },
      ],
    },
    {
      id: "liability",
      heading: "11. Our responsibility to you",
      blocks: [
        {
          kind: "note",
          text: "Nothing in this agreement limits or excludes our liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be limited or excluded. Nothing in this agreement affects your statutory rights as a consumer. If any part of this section is found to be unfair or unenforceable, the rest of it still applies.",
        },
        {
          kind: "p",
          text: "Subject to that, and because Pinpals introduces members rather than performing what they arrange between themselves, we are not responsible for:",
        },
        {
          kind: "ul",
          items: [
            "the acts, omissions, conduct, honesty or safety of any member;",
            "anything sold, bought or exchanged between members, including whether an item is genuine, as described, fit for purpose, or ever delivered;",
            "any tee time, round, travel arrangement or meeting arranged through the site, or anything that happens at or on the way to a course;",
            "any golf club's decisions, conditions, availability or conduct;",
            "loss you suffer because information a member gave was untrue.",
          ],
        },
        {
          kind: "p",
          text: "We are responsible for loss you suffer that is a foreseeable result of our breaking this agreement or failing to use reasonable care and skill. We are not responsible for loss that is not foreseeable.",
        },
        {
          kind: "p",
          text: "Where we are liable to you in connection with a marketplace transaction, our total liability for that transaction will not exceed the greater of the commission we received on it and the price paid for the item.",
        },
        {
          kind: "p",
          text: "If you use Pinpals for any business purpose, we are not liable to you for loss of profit, loss of business, business interruption or loss of business opportunity.",
        },
      ],
    },
    {
      id: "your-responsibility",
      heading: "12. Your responsibility to us",
      blocks: [
        {
          kind: "p",
          text: "If you break this agreement and someone brings a claim against us as a result — for example, over something you listed, sold or posted — you are responsible to us for the reasonable costs we incur in dealing with it. This applies only to the extent the claim arises from your own act or omission, and it does not apply where the loss is our fault.",
        },
      ],
    },
    {
      id: "closing",
      heading: "13. Closing your account",
      blocks: [
        {
          kind: "p",
          text: "You can close your account at any time from your dashboard, or by asking us. Closing it ends this agreement, except for anything already under way: an order in progress, a payment being settled, a refund outstanding or a dispute open.",
        },
        {
          kind: "p",
          text: "What happens to your personal data when you close your account, including what we must keep and for how long, is set out in the Privacy Policy.",
        },
      ],
    },
    {
      id: "changes",
      heading: "14. Changes to these Terms",
      blocks: [
        {
          kind: "p",
          text: "We may update this agreement — to reflect a new feature, a change in the law, or something we have learned. Every version has a number and a date, and every version you have accepted is listed in your dashboard under \"Legal & privacy\".",
        },
        {
          kind: "p",
          text: "When we publish a version that meaningfully changes your rights or obligations, we will ask you to review and accept it the next time you sign in, and we will tell you what changed. Continuing to use Pinpals after that is how you accept it. If you would rather not, you can close your account.",
        },
      ],
    },
    {
      id: "general",
      heading: "15. General",
      blocks: [
        {
          kind: "p",
          text: "If we do not enforce something straight away, we have not given up the right to enforce it later. If a court finds part of this agreement unenforceable, the rest of it continues to apply.",
        },
        {
          kind: "p",
          text: "This agreement is between you and us. Nobody else can enforce it.",
        },
        {
          kind: "p",
          text: "This agreement is governed by the law of Ireland, and the courts of Ireland have jurisdiction. If you are a consumer resident elsewhere in the European Union, you keep the protection of the mandatory law of the country you live in, and you may bring proceedings there.",
        },
        {
          kind: "p",
          text: `If you are unhappy with something, tell us first at ${OPERATOR.complaintsContact} — most things are quicker to fix that way. If you are a consumer and we cannot resolve it between us, you may be able to use an alternative dispute resolution scheme, and you can raise a consumer complaint with the Competition and Consumer Protection Commission.`,
        },
      ],
    },
  ],
};
