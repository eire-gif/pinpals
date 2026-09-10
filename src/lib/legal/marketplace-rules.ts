import type { LegalDocument } from "./types";
import { OPERATOR } from "./operator";

/**
 * Marketplace Rules, v1.0 — the operational detail behind section 5 of the
 * Terms.
 *
 * Split out from the Terms rather than folded into them because these are
 * the rules most likely to change as the marketplace develops (prohibited
 * items, delivery expectations, auction mechanics), and a version bump here
 * should not force every member to re-accept the whole Terms of Service.
 *
 * Kept consistent with the "facilitator" position: every rule below is
 * phrased as an obligation between the members, or as a condition of using
 * Pinpals — never as a promise by Pinpals about the goods.
 */
export const MARKETPLACE_RULES: LegalDocument = {
  slug: "marketplace-rules",
  consentType: "marketplace_rules",
  title: "Pinpals Marketplace Rules",
  shortTitle: "Marketplace Rules",
  version: "1.0",
  effectiveFrom: "2026-09-10",
  summary: "What you can list, how sales work, and what buyers and sellers owe each other.",
  keyPoints: [
    "Sell your own golf gear. No counterfeits, no stolen goods, no trade advertising.",
    "Describe it honestly, photograph it yourself, and disclose every fault.",
    "Offers and bids are commitments — a winning bid is a sale.",
    "Keep the payment on Pinpals: it's what makes refunds and disputes possible.",
    "Post it promptly, keep the tracking, and tell the buyer where it is.",
  ],
  sections: [
    {
      id: "what-you-can-sell",
      heading: "1. What you can list",
      blocks: [
        {
          kind: "p",
          text: "Pinpals is for golf equipment and golf-related items you own personally: clubs, bags, trolleys, shoes, apparel, technology, accessories and memorabilia.",
        },
        { kind: "p", text: "You may not list:" },
        {
          kind: "ul",
          items: [
            "counterfeit, replica or unauthorised copies of any brand's clubs or equipment — this is the single fastest way to have an account closed;",
            "anything you do not own, or are not entitled to sell, including stolen goods;",
            "club memberships, tee times, competition entries or anything else that is not a physical item;",
            "services of any kind, including lessons, club fitting or repairs;",
            "anything unlawful to sell, or that requires a licence you do not hold;",
            "items listed on behalf of a shop or business, unless we have agreed it in writing.",
          ],
        },
        {
          kind: "note",
          text: "If you sell in the course of a business rather than privately, you are a trader. Consumer law then applies to your sales — including a buyer's right to cancel a distance sale within 14 days — and complying with it is your responsibility. You must say clearly in your listing that you are a trader.",
        },
      ],
    },
    {
      id: "describing",
      heading: "2. Describing what you sell",
      blocks: [
        {
          kind: "p",
          text: "Your description and condition rating must be accurate, and your photographs must be of the actual item, taken by you. Stock photographs, manufacturer images and pictures taken from another listing are not acceptable.",
        },
        {
          kind: "p",
          text: "Disclose every fault that affects use or value — a cracked crown, a shaft that has been replaced, a re-gripped club, a worn face, a repair. A buyer who receives something materially different from the listing is entitled to a refund, and that comes out of your payout.",
        },
        {
          kind: "p",
          text: "Say what is actually included. A driver listed with a headcover and a torque wrench must arrive with both.",
        },
      ],
    },
    {
      id: "offers-and-auctions",
      heading: "3. Offers, bids and commitment",
      blocks: [
        {
          kind: "p",
          text: "An offer you make is a commitment to buy at that price if the seller accepts it. Accepting an offer is a commitment to sell.",
        },
        {
          kind: "p",
          text: "A bid in an auction cannot be withdrawn, and the highest bid at the close is a sale. Do not bid on your own listing, and do not arrange for anyone else to.",
        },
        {
          kind: "p",
          text: "Withdrawing after a sale is agreed — on either side, and without a good reason — is a breach of these Rules and may lead to a restriction on your account.",
        },
      ],
    },
    {
      id: "payment",
      heading: "4. Paying and being paid",
      blocks: [
        {
          kind: "p",
          text: "All payment goes through Pinpals' checkout, which is processed by Stripe. Pinpals deducts its commission and passes the balance to the seller.",
        },
        {
          kind: "note",
          text: "Taking a sale off-platform after meeting through Pinpals — cash, bank transfer, or any other route — is a breach of these Rules. It also removes every protection either of you has: no payment record, no refund route, no dispute process, and no recourse if the item never arrives.",
        },
        {
          kind: "p",
          text: "A seller's payout is released on the schedule shown in their dashboard. We may hold a payout where an order is disputed, where a refund is likely, or where we are investigating an account.",
        },
      ],
    },
    {
      id: "delivery",
      heading: "5. Getting it to the buyer",
      blocks: [
        {
          kind: "p",
          text: "Post within the timeframe stated in your listing, and within five working days if you did not state one. Use a tracked service for anything of real value, keep proof of postage, and add the tracking details to the order.",
        },
        {
          kind: "p",
          text: "Until the item reaches the buyer, the risk of loss or damage in transit is the seller's. Package clubs properly — a shaft broken by bad packing is the seller's problem, not the courier's and not the buyer's.",
        },
        {
          kind: "p",
          text: "If you are handing the item over in person, mark the order as delivered only once the buyer actually has it.",
        },
      ],
    },
    {
      id: "problems",
      heading: "6. When something goes wrong",
      blocks: [
        {
          kind: "p",
          text: "Message the other member first — most problems are a delayed courier or a misunderstanding, and both are quicker to fix directly.",
        },
        {
          kind: "p",
          text: "If that does not resolve it, open a support case from the order. Tell us what you expected, what happened, and attach photographs where they help. We will ask both members for their side.",
        },
        {
          kind: "p",
          text: "Where an item never arrived, or is materially not as described, we will normally refund the buyer from the payment we are holding or recover it from the seller. Where the item is simply not to the buyer's taste, and the seller is a private individual rather than a trader, there is generally no right to a refund.",
        },
        {
          kind: "p",
          text: `Report a listing you believe is counterfeit, stolen or fraudulent using the report option on the listing, or write to ${OPERATOR.complaintsContact}. We take this seriously and act quickly.`,
        },
      ],
    },
    {
      id: "reviews",
      heading: "7. Reviews",
      blocks: [
        {
          kind: "p",
          text: "Review only transactions you actually took part in, and describe your own experience. Do not trade reviews, buy them, arrange them, or leave one to pressure someone into a refund.",
        },
        {
          kind: "p",
          text: "We remove reviews that are abusive, contain personal information, or are plainly not about the transaction. We do not remove a review simply because it is negative.",
        },
      ],
    },
  ],
};
