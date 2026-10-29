import type { EventBridgeHandler } from "aws-lambda";
import { logger } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";
import { sendMail } from "../mailer.js";

/**
 * Email notifications, driven by domain events. Lives in the search service
 * because recipient addresses (members) are its data.
 *
 *   listing.shared                  → members of that search
 *   comment.created (by admin)     → members of that search
 *   comment.created (by client)    → the admin
 *   rating.saved                   → the admin
 *   member.invited (by client)     → the admin, plus the invitee when their
 *                                    account already existed (new accounts
 *                                    get Cognito's temporary-password mail)
 *
 * Notes: auto-matched listings don't notify (no explicit admin intent);
 * actors never get notified about their own action.
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const d = event.detail;
  if (!d.searchId) return;
  const customerUrl = process.env.CUSTOMER_URL ?? "";
  const adminUrl = process.env.ADMIN_URL ?? "";
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? "";

  const search = await repo.getSearch(d.searchId);
  const clientName = search?.clientName ?? "your search";

  const notifyMembers = async (subject: string, body: string) => {
    const members = await repo.listMembers(d.searchId!);
    const to = members
      .filter((m) => m.userId !== d.actorId && m.email)
      .map((m) => m.email);
    await sendMail({
      to,
      subject,
      body,
      link: customerUrl || undefined,
      linkLabel: "Open your apartment search"
    });
  };

  const notifyAdmin = async (subject: string, body: string) => {
    if (!adminEmail) return;
    await sendMail({
      to: [adminEmail],
      subject,
      body: `${body}\n\nSearch: ${clientName}`,
      link: adminUrl || undefined,
      linkLabel: "Open the admin panel"
    });
  };

  switch (event["detail-type"]) {
    case "listing.shared": {
      const title = (d.payload as { title?: string } | undefined)?.title ?? "";
      await notifyMembers(
        "A new apartment was shared with you",
        title
          ? `JJ shared "${title}" with you on your Berlin apartment search.`
          : d.summary
      );
      break;
    }
    case "comment.created":
      if (d.actorRole === "admin") {
        await notifyMembers("New comment from JJ", d.summary);
      } else {
        await notifyAdmin("New client comment", d.summary);
      }
      break;
    case "rating.saved":
      if (d.actorRole !== "admin") {
        await notifyAdmin("New rating from your client", d.summary);
      }
      break;
    case "member.invited": {
      if (d.actorRole === "admin") break;
      await notifyAdmin("Your client invited someone to their search", d.summary);
      const p = d.payload as
        | { email?: string; displayName?: string; accountCreated?: boolean }
        | undefined;
      if (p?.email && p.accountCreated === false) {
        await sendMail({
          to: [p.email],
          subject: "You've been added to an apartment search",
          body: `${d.actorName ?? "A client"} added you to ${clientName}'s Berlin apartment search. Sign in with your existing account to see it.`,
          link: customerUrl || undefined,
          linkLabel: "Open the apartment search"
        });
      }
      break;
    }
    default:
      logger.debug("ignoring event", { type: event["detail-type"] });
  }
};
