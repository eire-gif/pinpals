import { OpenInApp, openInAppMetadata } from "../open-in-app";

export const metadata = openInAppMetadata;

export default async function ScorecardOnWebPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safe = /^\d+$/.test(id) ? id : "";
  return <OpenInApp certify={false} appPath={safe ? `scorecards/${safe}` : "scorecards"} />;
}
