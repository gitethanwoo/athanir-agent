import type { Message } from "chat";

export interface SerializedAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

type SlackFileObject = {
  id?: string;
  file_access?: string;
  mimetype?: string;
  name?: string;
  original_h?: number;
  original_w?: number;
  size?: number;
  url_private?: string;
  url_private_download?: string;
};

type SlackMessageRaw = {
  files?: SlackFileObject[];
};

const SLACK_FILES_INFO_URL = "https://slack.com/api/files.info";

function getSlackBotToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

function getSlackDownloadUrl(file: SlackFileObject): string | null {
  return file.url_private_download ?? file.url_private ?? null;
}

async function downloadSlackFile(
  file: SlackFileObject
): Promise<SerializedAttachment | null> {
  const url = getSlackDownloadUrl(file);
  const token = getSlackBotToken();

  if (!url || !token) return null;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    name: file.name ?? "attachment",
    mimeType:
      (file.mimetype ?? contentType) || "application/octet-stream",
    dataBase64: Buffer.from(arrayBuffer).toString("base64"),
  };
}

async function fetchSlackFileInfo(fileId: string): Promise<SlackFileObject | null> {
  const token = getSlackBotToken();
  if (!token) return null;

  const response = await fetch(SLACK_FILES_INFO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ file: fileId }).toString(),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    error?: string;
    file?: SlackFileObject;
    ok?: boolean;
  };

  if (!payload.ok || !payload.file) return null;
  return payload.file;
}

async function fetchSlackRawFileAttachments(
  message: Message
): Promise<{ attachments: SerializedAttachment[]; fileCount: number }> {
  const raw = message.raw as SlackMessageRaw | undefined;
  const rawFiles = raw?.files ?? [];
  const results: SerializedAttachment[] = [];

  for (const file of rawFiles) {
    try {
      const needsHydration =
        file.file_access === "check_file_info" || !getSlackDownloadUrl(file);
      const downloadableFile =
        needsHydration && file.id ? await fetchSlackFileInfo(file.id) : file;

      if (!downloadableFile) continue;

      const attachment = await downloadSlackFile(downloadableFile);
      if (attachment) results.push(attachment);
    } catch {
      // Skip attachments that fail to resolve or download
    }
  }

  return { attachments: results, fileCount: rawFiles.length };
}

function hasAttachment(
  attachments: SerializedAttachment[],
  candidate: SerializedAttachment
): boolean {
  return attachments.some(
    (attachment) => attachment.dataBase64 === candidate.dataBase64
  );
}

/**
 * Fetch attachment bytes from a live Message (before workflow serialization).
 * Must be called while the adapter's auth context is still available.
 */
export async function fetchAttachments(
  message: Message
): Promise<SerializedAttachment[]> {
  const slackAttachments = await fetchSlackRawFileAttachments(message);
  const results = [...slackAttachments.attachments];

  if (
    slackAttachments.fileCount > 0 &&
    slackAttachments.attachments.length >= slackAttachments.fileCount
  ) {
    return results;
  }

  for (const att of message.attachments ?? []) {
    if (!att.fetchData) continue;
    try {
      const buffer = await att.fetchData();
      const attachment = {
        name: att.name ?? "attachment",
        mimeType: att.mimeType ?? "application/octet-stream",
        dataBase64: buffer.toString("base64"),
      };

      if (!hasAttachment(results, attachment)) {
        results.push(attachment);
      }
    } catch {
      // Skip attachments that fail to download
    }
  }

  return results;
}
