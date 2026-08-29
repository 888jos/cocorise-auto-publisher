import { createHash } from "crypto";
import { google } from "googleapis";

export type DriveVideoFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  md5Checksum?: string | null;
};

function serviceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string };
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n")
    };
  }
  return null;
}

function driveClient() {
  const serviceAccount = serviceAccountCredentials();
  if (serviceAccount) {
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    return google.drive({ version: "v3", auth });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive credentials are not configured. Use a service account or OAuth refresh token.");
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

export async function listReadyVideos() {
  const folderId = process.env.GOOGLE_DRIVE_READY_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_READY_FOLDER_ID is not configured.");

  const drive = driveClient();
  const files: DriveVideoFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
      fields: "nextPageToken,files(id,name,mimeType,size,md5Checksum)",
      pageSize: 1000,
      pageToken
    });

    files.push(...((response.data.files ?? []) as DriveVideoFile[]));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

// Keep the old export for callers compiled against the initial API.
export const listReadyMp4s = listReadyVideos;

export async function computeDriveFileHash(fileId: string) {
  const drive = driveClient();
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    response.data
      .on("data", (chunk: Buffer) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });

  return hash.digest("hex");
}

export async function downloadDriveFile(fileId: string) {
  const drive = driveClient();
  const metadata = await drive.files.get({ fileId, fields: "id,name,mimeType,size" });
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data as ArrayBuffer);

  return {
    filename: metadata.data.name ?? `${fileId}.mp4`,
    mimeType: metadata.data.mimeType ?? "video/mp4",
    size: Number(metadata.data.size ?? buffer.byteLength),
    buffer
  };
}
