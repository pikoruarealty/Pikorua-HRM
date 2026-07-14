import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Track B, Milestone 3.4. S3/R2 upload helper — employee documents and
// reimbursement receipts (Implementation Plan §1). Not on the shared-file
// list (didn't exist in Phase 0), but reusable infra — flag Umang since
// Track A doesn't currently have a file-upload need but might later.
//
// Pattern mirrors the existing `attachmentUrl` field on Request (Milestone
// 2.4): the client uploads directly to S3/R2 using a short-lived presigned
// PUT URL from this helper, then POSTs the resulting object URL to persist
// metadata — no file bytes pass through the Next.js server.

function getConfig() {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || "auto";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY in .env.",
    );
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
}

function getClient(): S3Client {
  const { endpoint, region, accessKeyId, secretAccessKey } = getConfig();
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** Presigned PUT URL the client uploads the file bytes to directly. */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { bucket } = getConfig();
  const client = getClient();
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/** Public/object URL for a key once uploaded (bucket must allow read or be fronted by a CDN). */
export function buildFileUrl(key: string): string {
  const { endpoint, bucket } = getConfig();
  return `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
}
