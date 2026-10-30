import { redirect } from "next/navigation";

/** Book a pro (0204): lesson alerts link here (the app opens its own screen); the website shows the booking page. */
export default async function LessonRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/lessons/${encodeURIComponent(id)}`);
}
