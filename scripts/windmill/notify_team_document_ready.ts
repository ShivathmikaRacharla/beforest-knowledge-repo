import postgres from 'npm:postgres@3'
import { getVariable } from 'npm:windmill-client@1'

const variable = (name: string) => getVariable(`f/kms/${name}`)

export async function main(
  document_key: string,
  document_name: string,
  collection_key: string,
  document_version = 1,
  uploaded_by?: string,
  ready_date?: string,
  document_url?: string,
) {
  const databaseUrl = (await variable('DATABASE_URL')).trim()
  if (!databaseUrl || /^(file:|sqlite:)/i.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string')
  }

  const documentKey = document_key?.trim()
  const documentName = document_name?.trim()
  const collectionKey = collection_key?.trim()
  if (!documentKey || !documentName || !collectionKey) {
    throw new Error('document_key, document_name, and collection_key are required')
  }

  const version = Number(document_version) || 1
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const teams = await sql`
      SELECT id, name FROM notification_teams
      WHERE collection_key = ${collectionKey} AND active = TRUE
      LIMIT 1
    `
    const team = teams[0]
    if (!team) return { skipped: true, reason: 'No active team matches the document collection.', collection_key: collectionKey }

    const members = await sql`
      SELECT u.id AS user_id
      FROM notification_team_members m
      JOIN app_users u ON u.id = m.user_id
      WHERE m.team_id = ${team.id} AND m.active = TRUE AND u.active = TRUE
      ORDER BY u.id
    `

    let notified = 0
    let skipped = 0
    const detail = `${documentName} is ready in ${team.name}. Uploaded by ${uploaded_by?.trim() || 'Beforest team'}${ready_date ? ` on ${ready_date}` : ''}.`
    for (const member of members) {
      const created = await sql.begin(async (tx) => {
        await tx`
          INSERT INTO document_notification_deliveries
            (document_key, document_version, team_id, user_id, status)
          VALUES (${documentKey}, ${version}, ${team.id}, ${member.user_id}, 'pending')
          ON CONFLICT (document_key, document_version, user_id) DO NOTHING
        `
        const [delivery] = await tx`
          SELECT id, status FROM document_notification_deliveries
          WHERE document_key = ${documentKey} AND document_version = ${version} AND user_id = ${member.user_id}
          FOR UPDATE
        `
        if (delivery.status === 'sent') return false
        await tx`
          INSERT INTO in_app_notifications (user_id, title, detail)
          VALUES (${member.user_id}, 'Document ready', ${detail})
        `
        await tx`
          UPDATE document_notification_deliveries
          SET status = 'sent', sent_at = NOW(), error_message = NULL, updated_at = NOW()
          WHERE id = ${delivery.id}
        `
        return true
      })
      if (created) notified += 1
      else skipped += 1
    }

    return { document_key: documentKey, document_version: version, team_id: team.id, recipients: members.length, notified, skipped, email_sent: false }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
