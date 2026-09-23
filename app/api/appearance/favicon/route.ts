import { getSettingValue } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const thumbnail = await getSettingValue("appearance.thumbnail", "");
    const match = thumbnail.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      return new Response(Buffer.from(match[2], "base64"), {
        headers: {
          "Content-Type": match[1],
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }
  } catch {
    // Fall back to the bundled favicon when appearance storage is unavailable.
  }
  return Response.redirect(new URL("/beforest-fallback-icon.png", request.url), 307);
}
