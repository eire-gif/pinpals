import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ADVERTISING_EDIT_ROLES, AdvertisingNotInstalledError, listAdvertisers, type Advertiser } from "@/lib/admin/advertising";
import { AdvertisingHeader, NotInstalled } from "../bits";
import CampaignForm, { type CampaignFormValues } from "../campaign-form";
import { saveCampaign } from "../actions";

// /admin/advertising/new — a new campaign. Editors only.
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff({ roles: ADVERTISING_EDIT_ROLES });
  const preset = Number((await searchParams).advertiser);

  let advertisers: Advertiser[];
  try {
    advertisers = await listAdvertisers();
  } catch (err) {
    if (err instanceof AdvertisingNotInstalledError) return <NotInstalled />;
    throw err;
  }

  const initial: CampaignFormValues = {
    id: null,
    status: "draft",
    advertiser_id: advertisers.some((a) => a.id === preset) ? preset : null,
    name: "",
    category: "golf_travel",
    format: "takeover",
    display_style: "artwork",
    countdown_seconds: 5,
    takeover_placement: "app_open",
    image_url: null,
    image_wide_url: null,
    image_square_url: null,
    headline: null,
    body: null,
    button_text: null,
    link_url: "",
    countries: [],
    regions: [],
    clubs: [],
    starts_at: null,
    ends_at: null,
    weight: 1,
    pricing_model: "flat",
    rate_eur: "",
    budget_cap_eur: "",
    payment_status: "unpaid",
  };

  return (
    <div>
      <p className="text-sm mb-2">
        <Link href="/admin/advertising" className="text-ink-500 hover:underline">
          ← Advertising
        </Link>
      </p>
      <AdvertisingHeader current={null} title="New campaign" subtitle="Save it as a draft as you go. It shows to nobody until it's approved and advertising is switched on." />
      <CampaignForm action={saveCampaign} initial={initial} advertisers={advertisers.map((a) => ({ id: a.id, name: a.name, logo_url: a.logo_url }))} canEdit />
    </div>
  );
}
