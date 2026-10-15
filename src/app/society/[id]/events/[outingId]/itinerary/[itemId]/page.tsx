import ItemPage from "../item-page";

export default async function EditItineraryItem({ params }: { params: Promise<{ id: string; outingId: string; itemId: string }> }) {
  const { id, outingId, itemId } = await params;
  return <ItemPage rawId={id} rawOuting={outingId} rawItem={itemId} />;
}
