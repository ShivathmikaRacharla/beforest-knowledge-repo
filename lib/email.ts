import nodemailer from "nodemailer";

function smtpPort() {
  const parsed = Number(process.env.SMTP_PORT || "587");
  return Number.isFinite(parsed) ? parsed : 587;
}

function smtpSecure() {
  const explicit = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  return smtpPort() === 465;
}

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
}

export async function sendInviteEmail(invite: {
  to: string;
  name: string;
  email: string;
  password: string;
  role: string;
}) {
  if (!emailConfigured()) {
    return { sent: false, error: "SMTP is not configured." };
  }

  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort(),
    secure: smtpSecure(),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: invite.to,
    subject: "Your Beforest AI login",
    text: [
      `Hi ${invite.name},`,
      "",
      "Your Beforest AI account has been created.",
      "",
      `Login URL: ${appUrl}`,
      `Username: ${invite.email}`,
      `Temporary password: ${invite.password}`,
      `Role: ${invite.role}`,
      "",
      "Please keep these credentials private.",
      "",
      "Regards,",
      "Beforest AI",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #18211e; line-height: 1.5;">
        <h2 style="color:#073c30;">Your Beforest AI login</h2>
        <p>Hi ${invite.name},</p>
        <p>Your Beforest AI account has been created.</p>
        <table cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #dde3df;">
          <tr><td><strong>Login URL</strong></td><td><a href="${appUrl}">${appUrl}</a></td></tr>
          <tr><td><strong>Username</strong></td><td>${invite.email}</td></tr>
          <tr><td><strong>Temporary password</strong></td><td>${invite.password}</td></tr>
          <tr><td><strong>Role</strong></td><td>${invite.role}</td></tr>
        </table>
        <p>Please keep these credentials private.</p>
        <p>Regards,<br/>Beforest AI</p>
      </div>
    `,
  });

  return { sent: true };
}
