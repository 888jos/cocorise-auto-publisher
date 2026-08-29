import type { SupabaseClient } from "@supabase/supabase-js";

type LogInput = {
  action: string;
  status: string;
  error?: string;
  videoId?: string;
  accountGroupId?: string;
  publicationId?: string;
};

export async function logAction(db: SupabaseClient, input: LogInput) {
  await db.from("action_logs").insert({
    action: input.action,
    status: input.status,
    error: input.error,
    video_id: input.videoId,
    account_group_id: input.accountGroupId,
    publication_id: input.publicationId
  });
}
