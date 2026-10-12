import { OpenInApp, openInAppMetadata } from "../../open-in-app";

export const metadata = openInAppMetadata;

export default async function CertifyOnWebPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safe = /^\d+$/.test(id) ? id : "";
  return <OpenInApp certify appPath={safe ? `scorecards/certify/${safe}` : "scorecards"} />;
}
