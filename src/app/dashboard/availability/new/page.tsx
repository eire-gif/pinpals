import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewAvailabilityForm from "./new-availability-form";

export default async function NewAvailabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Tee-time invites
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Post your availability.</h1>
        <p className="text-ink-500 mt-2">
          Let other Pinpals members know you&rsquo;ve got room for a game — it goes live
          straight away and other members can see it in tee-time invites.
        </p>
      </div>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <NewAvailabilityForm />
      </div>
    </div>
  );
}
