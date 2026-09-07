"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import OfferForm from "./offer-form";

/**
 * "Build the offer sheet/modal" (this phase's spec) — a small, dependency-
 * free dialog wrapping OfferForm, triggered from PurchasePanel. A portal
 * into `document.body` keeps it above everything else on the page
 * regardless of where PurchasePanel itself sits in the DOM (the sticky
 * desktop sidebar vs. the inline mobile block — see purchase-panel.tsx's
 * own header comment on why there are two render sites), without needing a
 * portal library. `document` is only ever touched once `open` is true,
 * which can only happen from the click handler below — i.e. after
 * hydration, on the client — so this needs no separate "have we mounted
 * yet" state/effect the way a portal rendered open-by-default would.
 * Escape-to-close and a backdrop click are both wired since this is the one
 * genuinely modal interaction this app introduces.
 */
export default function OfferSheet({
  listingId,
  askingPrice,
  minAmount,
}: {
  listingId: number;
  askingPrice: number;
  minAmount: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-3.5 rounded-full font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition"
      >
        Make an offer
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-navy-900/50"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="offer-sheet-title"
              className="relative bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="offer-sheet-title" className="font-display font-bold text-lg">
                  Make an offer
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-ink-500 hover:text-ink-900 text-2xl leading-none px-1"
                >
                  &times;
                </button>
              </div>
              <OfferForm
                listingId={listingId}
                askingPrice={askingPrice}
                minAmount={minAmount}
                onSent={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
