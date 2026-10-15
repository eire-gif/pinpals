import ItemPage from "../item-page";

export default async function NewItineraryItem({ params, searchParams }: { params: Promise<{ id: string; outingId: string }>; searchParams: Promise<{ kind?: string; day?: string }> }) {
  const { id, outingId } = await params;
  const { kind, day } = await searchParams;
  return <ItemPage rawId={id} rawOuting={outingId} rawItem={null} kindParam={kind} dayParam={day} />;
}
