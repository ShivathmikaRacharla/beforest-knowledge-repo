import { requireRole } from "@/lib/auth";
import { getSettingValue, getNotificationTeam, getNotificationTeamByCollectionKey, markDocumentNotificationDelivery, notificationTeamExists, prepareDocumentNotificationDeliveries } from "@/lib/db";
import { sendDocumentReadyEmail } from "@/lib/email";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ReadyDocument = {
  documentKey?: string;
  documentVersion?: number;
  documentName?: string;
  teamId?: number;
  collectionKey?: string;
  uploadedBy?: string;
  readyDate?: string;
  documentUrl?: string;
};

export async function POST(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as ReadyDocument;
  const documentKey = body.documentKey?.trim();
  const documentName = body.documentName?.trim();
  const team = body.teamId ? (notificationTeamExists(body.teamId) ? getNotificationTeam(body.teamId) : undefined) : body.collectionKey ? getNotificationTeamByCollectionKey(body.collectionKey.trim()) : undefined;
  if (!documentKey || !documentName || !team) return NextResponse.json({ error: "documentKey, documentName and a valid team are required." }, { status: 400 });
  if (getSettingValue("emailNotifications", "false") !== "true") return NextResponse.json({ skipped: true, reason: "Email notifications are disabled." });

  const teamDetails = body.collectionKey ? getNotificationTeamByCollectionKey(body.collectionKey.trim()) : undefined;
  const teamName = teamDetails?.name || team.name;
  const deliveries = prepareDocumentNotificationDeliveries({ documentKey, documentVersion: body.documentVersion || 1, teamId: team.id });
  let sent = 0;
  let skipped = 0;
  for (const delivery of deliveries) {
    if (delivery.status === "sent") {
      skipped += 1;
      continue;
    }
    const result = await (async () => {
      try {
        await sendDocumentReadyEmail({
          to: delivery.email,
          recipientName: delivery.name,
          documentName,
          teamName,
          uploadedBy: body.uploadedBy?.trim() || "Beforest team",
          readyDate: body.readyDate?.trim() || new Date().toISOString(),
          documentUrl: body.documentUrl?.trim() || process.env.APP_URL || "http://localhost:3002/documents",
        });
        return "sent" as const;
      } catch (error) {
        markDocumentNotificationDelivery(delivery.deliveryId, "failed", error instanceof Error ? error.message : "Notification email failed.");
        return "failed" as const;
      }
    })();
    if (result === "sent") {
      markDocumentNotificationDelivery(delivery.deliveryId, "sent");
      sent += 1;
    } else {
      skipped += 1;
    }
  }
  return NextResponse.json({ documentKey, teamId: team.id, recipients: deliveries.length, sent, skipped, failed: deliveries.length - sent - skipped });
}
