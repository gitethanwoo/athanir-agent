import type { Message } from "chat";

export interface SerializedAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/**
 * Fetch attachment bytes from a live Message (before workflow serialization).
 * Must be called while the adapter's auth context is still available.
 */
export async function fetchAttachments(
  message: Message
): Promise<SerializedAttachment[]> {
  const results: SerializedAttachment[] = [];
  for (const att of message.attachments ?? []) {
    if (!att.fetchData) continue;
    try {
      const buffer = await att.fetchData();
      results.push({
        name: att.name ?? "attachment",
        mimeType: att.mimeType ?? "application/octet-stream",
        dataBase64: buffer.toString("base64"),
      });
    } catch {
      // Skip attachments that fail to download
    }
  }
  return results;
}
