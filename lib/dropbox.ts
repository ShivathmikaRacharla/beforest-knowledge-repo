async function getDropboxAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!appKey || !appSecret || !refreshToken) {
    throw new Error("Dropbox connection variables are not configured.");
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox token refresh failed (${response.status}).`);
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Dropbox did not return an access token.");
  }
  return data.access_token;
}

async function findDropboxDocumentPath(accessToken: string, fileName: string) {
  const response = await fetch("https://api.dropboxapi.com/2/files/search_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: fileName,
      options: {
        filename_only: true,
        max_results: 10,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox document search failed (${response.status}).`);
  }

  const data = await response.json() as {
    matches?: Array<{
      metadata?: {
        metadata?: {
          ".tag"?: string;
          name?: string;
          path_display?: string;
          path_lower?: string;
        };
      };
    }>;
  };
  const match = (data.matches || [])
    .map((item) => item.metadata?.metadata)
    .find((metadata) => metadata?.[".tag"] === "file" && metadata.name === fileName);
  return match?.path_display || match?.path_lower || null;
}

async function downloadDropboxDocument(accessToken: string, dropboxPath: string) {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath }),
    },
  });

  if (!response.ok) {
    throw new Error(`Dropbox document download failed (${response.status}).`);
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

function mimeTypeForFileName(fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "txt") return "text/plain; charset=utf-8";
  if (extension === "md") return "text/markdown; charset=utf-8";
  if (extension === "csv") return "text/csv; charset=utf-8";
  if (extension === "html") return "text/html; charset=utf-8";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

export async function getDropboxDocumentFile(dropboxPath: string, fileName?: string) {
  const accessToken = await getDropboxAccessToken();
  try {
    const file = await downloadDropboxDocument(accessToken, dropboxPath);
    return {
      bytes: file.bytes,
      contentType: file.contentType === "application/octet-stream" ? mimeTypeForFileName(fileName) : file.contentType,
    };
  } catch (error) {
    if (!fileName) throw error;
    const fallbackPath = await findDropboxDocumentPath(accessToken, fileName);
    if (!fallbackPath) throw error;
    const file = await downloadDropboxDocument(accessToken, fallbackPath);
    return {
      bytes: file.bytes,
      contentType: file.contentType === "application/octet-stream" ? mimeTypeForFileName(fileName) : file.contentType,
    };
  }
}

function previewUrl(link: string) {
  try {
    const url = new URL(link);
    url.searchParams.delete("dl");
    url.searchParams.set("dl", "0");
    return url.toString();
  } catch {
    return link.replace(/[?&]dl=1\b/, "").concat(link.includes("?") ? "&dl=0" : "?dl=0");
  }
}

async function listExistingSharedLink(accessToken: string, dropboxPath: string) {
  const response = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: dropboxPath }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox shared link lookup failed (${response.status}).`);
  }

  const data = await response.json() as { links?: Array<{ url?: string }> };
  return data.links?.find((link) => link.url)?.url || null;
}

async function createPreviewLink(accessToken: string, dropboxPath: string) {
  const response = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: dropboxPath }),
  });

  if (!response.ok) {
    const text = await response.text();
    let existingUrl: string | undefined;
    try {
      const data = JSON.parse(text) as {
        error?: {
          shared_link_already_exists?: {
            metadata?: {
              url?: string;
            };
          };
        };
      };
      existingUrl = data.error?.shared_link_already_exists?.metadata?.url;
    } catch {
      // Keep the generic error below when Dropbox returns non-JSON text.
    }
    if (existingUrl) return previewUrl(existingUrl);
    if (response.status === 409) {
      try {
        const fallback = await listExistingSharedLink(accessToken, dropboxPath);
        if (fallback) return previewUrl(fallback);
      } catch {
        // Fall through to the original creation error.
      }
    }
    throw new Error(`Dropbox preview link creation failed (${response.status}).`);
  }

  const data = await response.json() as { url?: string };
  if (!data.url) {
    throw new Error("Dropbox did not return a document link.");
  }
  return previewUrl(data.url);
}

export async function getDropboxPreviewLink(dropboxPath: string, fileName?: string) {
  const accessToken = await getDropboxAccessToken();
  try {
    return await createPreviewLink(accessToken, dropboxPath);
  } catch (error) {
    if (!fileName) throw error;
    const fallbackPath = await findDropboxDocumentPath(accessToken, fileName);
    if (!fallbackPath) throw error;
    return createPreviewLink(accessToken, fallbackPath);
  }
}
