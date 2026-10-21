/**
 * The Live day's five steps (Oct 2026), the same bar on every page they
 * lead to — set-up, the draw, start, the control room, results — so an
 * organiser can move between them without losing their place. Pure.
 */

export type StepState = "done" | "now" | "next";
export type Step = { label: string; sub: string; state: StepState; href?: string };
export type StepNumber = 1 | 2 | 3 | 4 | 5;

export function liveSteps(
  groupId: number,
  o: { id: number; drawPublishedAt: string | null; matchDayId: number | null },
  opts: { current: StepNumber; inDraw: number; published: boolean }
): Step[] {
  const base = `/society/${groupId}/live/${o.id}`;
  const started = o.matchDayId != null;
  const state = (n: StepNumber, done: boolean): StepState => (n === opts.current ? "now" : done ? "done" : "next");
  return [
    { label: "Set up", sub: started ? "Done" : "Tees, card, format", state: state(1, started), href: started ? base : `${base}#setup` },
    {
      label: "Players & groups",
      sub: started ? `${opts.inDraw} in the draw` : o.drawPublishedAt ? `${opts.inDraw} in · add / remove` : "Add players, make the draw",
      state: state(2, o.drawPublishedAt != null),
      href: `/society/${groupId}/events/${o.id}/draw`,
    },
    { label: "Start", sub: started ? "Started" : "Open scoring", state: state(3, started), href: started ? base : `${base}#start` },
    { label: "Live", sub: opts.published ? "Scoring closed" : "Scoreboard", state: state(4, opts.published), href: base },
    { label: "Results", sub: opts.published ? "Published" : "Podium & publish", state: state(5, opts.published), href: `${base}/results` },
  ];
}
