import postgres from 'npm:postgres@3'
import nodemailer from 'npm:nodemailer@7'
import { getVariable } from 'npm:windmill-client@1'

const variable = (name: string) => getVariable(`f/kms/${name}`)

function required(value: string | undefined, name: string) {
  const next = value?.trim()
  if (!next) throw new Error(`${name} is not configured`)
  return next
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (character) => entities[character] || character)
}

function smtpSecure(port: number, configured: string | undefined) {
  const explicit = configured?.trim().toLowerCase()
  if (explicit === 'true' || explicit === '1') return true
  if (explicit === 'false' || explicit === '0') return false
  return port === 465
}

export async function main(
  document_key: string,
  document_name: string,
  collection_key: string,
  document_version = 1,
  uploaded_by?: string,
  ready_date?: string,
  document_url?: string,
) {
  const enabled = (await variable('EMAIL_NOTIFICATIONS_ENABLED').catch(() => 'true')).trim().toLowerCase()
  if (['false', '0', 'off', 'no'].includes(enabled)) {
    return { skipped: true, reason: 'Email notifications are disabled.' }
  }

  const databaseUrl = required(await variable('DATABASE_URL').catch(() => ''), 'DATABASE_URL')
  if (databaseUrl.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a reachable PostgreSQL URL for Windmill notifications; local SQLite files are not reachable from Windmill.')
  }

  const smtpHost = required(await variable('SMTP_HOST').catch(() => ''), 'SMTP_HOST')
  const smtpPortValue = Number(await variable('SMTP_PORT').catch(() => '587'))
  const smtpUser = required(await variable('SMTP_USER').catch(() => ''), 'SMTP_USER')
  const smtpPassword = required(await variable('SMTP_PASSWORD').catch(() => ''), 'SMTP_PASSWORD')
  const smtpFrom = required(await variable('SMTP_FROM').catch(() => ''), 'SMTP_FROM')
  const appUrl = (await variable('APP_URL').catch(() => ''))?.trim() || 'http://localhost:3002/documents'
  const documentKey = document_key?.trim()
  const documentName = document_name?.trim()
  const collectionKey = collection_key?.trim()
  if (!documentKey || !documentName || !collectionKey) {
    throw new Error('document_key, document_name, and collection_key are required')
  }

  const version = document_version || 1
  const readyDate = ready_date?.trim() || new Date().toISOString()
  const uploadedBy = uploaded_by?.trim() || 'Beforest team'
  const documentUrl = document_url?.trim() || `${appUrl.replace(/\/$/, '')}/documents`
  const sql = postgres(databaseUrl, { max: 1 })
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPortValue) ? smtpPortValue : 587,
    secure: smtpSecure(smtpPortValue, await variable('SMTP_SECURE').catch(() => '')),
    auth: { user: smtpUser, pass: smtpPassword },
  })

  try {
    const teams = await sql`
      SELECT id, name
      FROM notification_teams
      WHERE collection_key = ${collectionKey} AND active = TRUE
      LIMIT 1
    `
    const team = teams[0]
    if (!team) return { skipped: true, reason: 'No active notification team matches the document collection.', collection_key: collectionKey }

    const members = await sql`
      SELECT u.id AS user_id, u.name, u.email
      FROM notification_team_members m
      JOIN app_users u ON u.id = m.user_id
      WHERE m.team_id = ${team.id} AND m.active = TRUE AND u.active = TRUE
      ORDER BY u.id
    `
    let sent = 0
    let skipped = 0
    let failed = 0

    for (const member of members) {
      const existing = await sql`
        SELECT id, status
        FROM document_notification_deliveries
        WHERE document_key = ${documentKey} AND document_version = ${version} AND user_id = ${member.user_id}
        LIMIT 1
      `
      const delivery = existing[0] || (await sql`
        INSERT INTO document_notification_deliveries
          (document_key, document_version, team_id, user_id, status)
        VALUES (${documentKey}, ${version}, ${team.id}, ${member.user_id}, 'pending')
        ON CONFLICT (document_key, document_version, user_id) DO UPDATE SET team_id = EXCLUDED.team_id
        RETURNING id, status
      `)[0]

      if (delivery.status === 'sent') {
        skipped += 1
        continue
      }

      try {
        const safeName = escapeHtml(String(member.name))
        const safeDocumentName = escapeHtml(documentName)
        const safeTeamName = escapeHtml(String(team.name))
        const safeUploadedBy = escapeHtml(uploadedBy)
        const safeReadyDate = escapeHtml(readyDate)
        const safeDocumentUrl = escapeHtml(documentUrl)
        await transporter.sendMail({
          from: smtpFrom,
          to: member.email,
          subject: `New knowledge document ready: ${documentName}`,
          text: [
            `Hi ${member.name},`,
            '',
            'A new document is ready in your permitted knowledge base.',
            `Document: ${documentName}`,
            `Team: ${team.name}`,
            `Uploaded by: ${uploadedBy}`,
            `Ready date: ${readyDate}`,
            `Open document: ${documentUrl}`,
          ].join('\n'),
          html: `<div style="font-family:Arial,sans-serif;color:#18211e;line-height:1.5"><h2 style="color:#073c30">New knowledge document ready</h2><p>Hi ${safeName},</p><p>A new document is ready in your permitted knowledge base.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #dde3df"><tr><td><strong>Document</strong></td><td>${safeDocumentName}</td></tr><tr><td><strong>Team</strong></td><td>${safeTeamName}</td></tr><tr><td><strong>Uploaded by</strong></td><td>${safeUploadedBy}</td></tr><tr><td><strong>Ready date</strong></td><td>${safeReadyDate}</td></tr></table><p><a href="${safeDocumentUrl}">Open document</a></p></div>`,
        })
        await sql`
          UPDATE document_notification_deliveries
          SET status = 'sent', sent_at = NOW(), error_message = NULL, updated_at = NOW()
          WHERE id = ${delivery.id}
        `
        sent += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Notification email failed.'
        await sql`
          UPDATE document_notification_deliveries
          SET status = 'failed', error_message = ${message}, updated_at = NOW()
          WHERE id = ${delivery.id}
        `
        failed += 1
      }
    }

    return { document_key: documentKey, document_version: version, team_id: team.id, team_name: team.name, recipients: members.length, sent, skipped, failed, dropbox_untouched: true }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
