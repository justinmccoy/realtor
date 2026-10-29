import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { logger } from "@jj/lambda-kit";

let client: SESv2Client | undefined;
function ses(): SESv2Client {
  if (!client) client = new SESv2Client({});
  return client;
}

export interface Mail {
  to: string[];
  subject: string;
  /** Short plain-text body; a minimal HTML wrapper is derived from it. */
  body: string;
  /** Optional call-to-action link appended to the body. */
  link?: string;
  linkLabel?: string;
}

/** Sends via SES. No-ops (with a log) when MAIL_FROM isn't configured, so the
 *  platform works before email is set up. Never throws — a failed mail must
 *  not fail or retry-loop the event that triggered it. */
export async function sendMail(mail: Mail): Promise<void> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    logger.info("MAIL_FROM not set — skipping notification", {
      subject: mail.subject,
      recipients: mail.to.length
    });
    return;
  }
  if (!mail.to.length) return;
  const text = mail.link
    ? `${mail.body}\n\n${mail.linkLabel ?? "Open"}: ${mail.link}`
    : mail.body;
  const html = `<!doctype html><body style="font-family:sans-serif;color:#2B1A14;line-height:1.5">
<p>${escapeHtml(mail.body).replace(/\n/g, "<br>")}</p>
${mail.link ? `<p><a href="${escapeHtml(mail.link)}" style="background:#17694A;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(mail.linkLabel ?? "Open")}</a></p>` : ""}
<p style="color:#6F554B;font-size:13px">— Genau Here</p></body>`;
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: mail.to },
        Content: {
          Simple: {
            Subject: { Data: mail.subject },
            Body: { Text: { Data: text }, Html: { Data: html } }
          }
        }
      })
    );
  } catch (err) {
    logger.error("failed to send notification email", err as Error);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
