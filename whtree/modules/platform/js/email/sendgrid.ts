import type { ParsedBounceMessage } from "./types";

/**
 * The full list of possible event types sent by SendGrid
 */
type SendGridEventType = 'processed' | 'dropped' | 'delivered' | 'deferred' | 'bounce'
  | 'open' | 'click' | 'spamreport' | 'unsubscribe'
  | 'group_unsubscribe' | 'group_resubscribe';

/**
 * Base interface for fields present in every single event
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event
 */
interface SendGridBaseEvent {
  email: string;
  timestamp: number; // Unix timestamp
  event: SendGridEventType;
  sg_event_id: string;
  sg_message_id: string;
  useragent?: string;
  ip?: string;
  "smtp-id": string;
  response?: string;
  bounce_classification?: string;
  status?: string;
  reason?: string;
}

export function parseSendGridMessage(msg: unknown): ParsedBounceMessage {
  const parsed = msg as SendGridBaseEvent;
  const ourmessageid = parsed["smtp-id"] || "";
  const recipient = parsed.email || "";
  const timestamp = Temporal.Instant.fromEpochMilliseconds(parsed.timestamp * 1000);

  if (parsed.event === "delivered") //parse according to test message below
    return {
      basictype: "delivery",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp,
        remotemtaip: parsed.ip || "",
        reportingmta: "",
        feedbackid: "",
        smtpresponse: parsed.response || ""
      }
    };

  if (parsed.event === "bounce" || parsed.event === "dropped") { //parse according to test message below
    const ispermanent = parsed.status?.startsWith("5.") || false;
    return {
      basictype: "bounce",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp,
        remotemtaip: parsed.ip || "",
        reportingmta: "",
        feedbackid: "",
        ispermanent,
        bouncetype: ispermanent ? "Permanent" : "Transient",
        bouncesubtype: "",
        bouncestatus: parsed.status || "",
        bounceaction: "",
        bouncediagnosticcode: parsed.reason || "",
        bounceemailaddress: recipient
      }
    };
  }

  if (parsed.event === "spamreport") {
    return {
      basictype: "complaint",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp,
        remotemtaip: parsed.ip || "",
        reportingmta: "",
        useragent: parsed.useragent || "",
        feedbackid: "",
        complainedemailaddress: recipient,
        complaintfeedbacktype: ""
      }
    };
  }

  return { basictype: "", basicobject: null, ourmessageid, recipient: parsed.email || "" };
}
