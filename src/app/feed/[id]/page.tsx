import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { getPost } from "@/lib/feed-server";
import { createClient } from "@/lib/supabase/server";
import PostCard from "../post-card";

export const metadata: Metadata = { title: "Post · PinPals" };

/**
 * One post with every comment — where a notification about a like or a
 * comment lands, and where "View all N comments" goes.
 *
 * A post that does not exist and a post the viewer may not see are both a
 * 404. Saying "this post is connections-only" would tell a stranger that
 * the post exists and whose it is.
 */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/feed/${postId}`);

  const post = await getPost(supabase, user.id, postId);
  if (!post) notFound();

  return (
    <div className="max-w-[680px] mx-auto px-4 sm:px-6 py-8 grid gap-4">
      <Link href="/feed" className="text-sm font-bold text-green-700 hover:underline justify-self-start">
        ← Back to the feed
      </Link>
      <PostCard post={post} standalone />
    </div>
  );
}
