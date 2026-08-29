import { computeDriveFileHash, listReadyVideos } from "@/lib/services/googleDrive";
import { createServiceClient } from "@/lib/supabase/server";
import { logAction } from "@/lib/logger";

export async function runDriveSync() {
  const db = createServiceClient();
  const files = await listReadyVideos();
  if (!files.length) return { imported: 0, skipped: 0, scanned: 0 };

  const { data: existing, error: existingError } = await db.from("videos").select("drive_file_id,file_hash");
  if (existingError) throw new Error(`Unable to read existing videos: ${existingError.message}`);

  const knownDriveIds = new Set((existing ?? []).map((video) => video.drive_file_id));
  const knownHashes = new Set((existing ?? []).map((video) => video.file_hash));
  const rows: Array<{ drive_file_id: string; filename: string; file_hash: string; status: "available" }> = [];

  for (const file of files) {
    if (knownDriveIds.has(file.id)) continue;
    const fileHash = file.md5Checksum ? `md5:${file.md5Checksum}` : await computeDriveFileHash(file.id);
    if (knownHashes.has(fileHash)) continue;

    knownDriveIds.add(file.id);
    knownHashes.add(fileHash);
    rows.push({ drive_file_id: file.id, filename: file.name, file_hash: fileHash, status: "available" });
  }

  if (!rows.length) return { imported: 0, skipped: files.length, scanned: files.length };

  const { data, error } = await db.from("videos").insert(rows).select("id");
  if (error) {
    await logAction(db, { action: "drive_import", status: "failed", error: error.message });
    throw new Error(`Unable to import Drive videos: ${error.message}`);
  }

  if (data?.length) {
    await db.from("action_logs").insert(
      data.map((video) => ({ action: "drive_import", status: "imported", video_id: video.id }))
    );
  }

  const imported = data?.length ?? 0;
  return { imported, skipped: files.length - imported, scanned: files.length };
}
