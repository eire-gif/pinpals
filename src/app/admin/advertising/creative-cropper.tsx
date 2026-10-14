"use client";

import { useEffect, useRef, useState } from "react";
import { CREATIVE_SPECS, type CreativeSlot } from "@/lib/advertising";
import { CENTRED, MAX_ZOOM, cropRect, outputSize, panBy, type CropChoice } from "@/lib/images/fit-creative";

/**
 * Crop an advert image to its slot's shape — made for a phone.
 *
 * Shown when the chosen image isn't already the slot's shape (an iPhone photo
 * is 3:4, a screenshot 9:19.5). Drag the picture to position it, use the
 * slider to zoom, then "Use this". The preview is drawn with the same maths
 * the upload uses (cropRect in src/lib/images/fit-creative.ts), so what you
 * see is exactly what is uploaded. The dashed boxes are where the Sponsored
 * label, countdown and close button sit — keep text out of them.
 */
export default function CreativeCropper({
  slot,
  bitmap,
  onCancel,
  onConfirm,
}: {
  slot: CreativeSlot;
  bitmap: ImageBitmap;
  onCancel: () => void;
  onConfirm: (choice: CropChoice) => void;
}) {
  const spec = CREATIVE_SPECS[slot];
  const ratio = spec.ratioW / spec.ratioH;
  const [choice, setChoice] = useState<CropChoice>(CENTRED);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const crop = cropRect(slot, bitmap.width, bitmap.height, choice);
  const size = outputSize(slot, crop);

  // Redraw the preview whenever the crop changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(frame.clientWidth * dpr));
    const h = Math.max(1, Math.round(frame.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    const r = cropRect(slot, bitmap.width, bitmap.height, choice);
    ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
  }, [bitmap, choice, slot]);

  // Escape closes, as any dialog should.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const frame = frameRef.current;
    if (!d || d.id !== e.pointerId || !frame) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setChoice((c) => panBy(slot, bitmap.width, bitmap.height, c, dx, dy, frame.clientWidth));
  }
  function endDrag() {
    drag.current = null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Crop to ${spec.label}`}
      className="fixed inset-0 z-50 bg-navy-900/80 flex items-end sm:items-center justify-center"
    >
      <div className="w-full sm:max-w-md bg-cream-50 rounded-t-2xl sm:rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] grid gap-3 max-h-[100dvh] overflow-y-auto">
        <div>
          <h2 className="font-display text-lg text-ink-900">Fit to {spec.label}</h2>
          <p className="text-xs text-ink-500">Drag the picture to position it. Use the slider to zoom.</p>
        </div>

        <div
          ref={frameRef}
          className="relative mx-auto rounded-lg overflow-hidden bg-navy-900 cursor-grab active:cursor-grabbing select-none"
          style={{ width: `min(100%, calc(55dvh * ${ratio}))`, aspectRatio: `${spec.ratioW} / ${spec.ratioH}`, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
          {slot === "takeover" && (
            <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-gold-400/80 bg-navy-900/25 pointer-events-none" />
          )}
          {slot === "banner" && (
            <div className="absolute top-0 right-0 w-[15%] h-[40%] border border-dashed border-gold-400/80 bg-navy-900/25 pointer-events-none" />
          )}
        </div>

        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={choice.zoom}
            onChange={(e) => setChoice((c) => ({ ...c, zoom: Number(e.target.value) }))}
            className="w-full accent-green-700 h-8"
          />
        </label>

        <p className={`text-xs ${"error" in size ? "text-red-600" : "text-ink-500"}`}>
          {"error" in size ? size.error : `Will upload at ${size.width} × ${size.height}.`}
        </p>

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className="min-h-11 px-4 rounded-full border border-line text-sm font-bold text-ink-900">
            Cancel
          </button>
          <button
            type="button"
            disabled={"error" in size}
            onClick={() => onConfirm(choice)}
            className="min-h-11 px-5 rounded-full bg-green-700 text-cream-50 text-sm font-bold disabled:opacity-50"
          >
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}
