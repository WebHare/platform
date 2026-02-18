export type BounceMessageRoot = {
  notificationType: Extract<string, "Bounce" | "Complaint" | "Delivery">;
  mail?: Mail;
} | {
  eventType: Extract<string, "Bounce" | "Complaint" | "Delivery">;
  mail?: Mail;
} | {
  notificationType: "Bounce";
  bounce: Bounce;
  mail: Mail;
} | {
  notificationType: "Complaint";
  complaint: Complaint;
  mail: Mail;
} | {
  notificationType: "Delivery";
  delivery: Delivery;
  mail: Mail;
} | {
  eventType: "Bounce";
  bounce: Bounce;
  mail: Mail;
} | {
  eventType: "Complaint";
  complaint: Complaint;
  mail: Mail;
} | {
  eventType: "Delivery";
  delivery: Delivery;
  mail: Mail;
};

export interface Bounce {
  bounceType: string;
  reportingMTA: string;
  bouncedRecipients: BouncedRecipient[];
  bounceSubType: string;
  timestamp: string;
  feedbackId: string;
  remoteMtaIp?: string;
}

export interface Complaint {
  userAgent?: string;
  complainedRecipients: { emailAddress: string }[];
  complaintFeedbackType: string;
  arrivalDate: string;
  timestamp: string;
  feedbackId: string;
}

export interface Delivery {
  timestamp: string;
  recipients: string[];
  processingTimeMillis: number;
  reportingMTA: string;
  smtpResponse: string;
  remoteMtaIp: string;
}

export interface BouncedRecipient {
  emailAddress: string;
  status: string;
  action: string;
  diagnosticCode: string;
}

export interface Mail {
  timestamp: string;
  source: string;
  sourceArn: string;
  sourceIp: string;
  sendingAccountId: string;
  callerIdentity: string;
  messageId: string;
  destination: string[];
  headersTruncated: boolean;
  headers: Header[];
  commonHeaders: CommonHeaders;
}

export interface Header {
  name: string;
  value: string;
}

export interface CommonHeaders {
  from: string[];
  date: string;
  to: string[];
  messageId: string;
  subject: string;
}

//Parse a SNS message, return it into a format our old HareScript code understands
export function parseSNSMessage(postBody: string) {
  const parsedBody = JSON.parse(postBody);
  const parsedMessage = JSON.parse(parsedBody.Message) as BounceMessageRoot;

  //TODO so why isn't AWS SES c2 putting our messaeg-id in `messageId` or give us some other *guaranteed* marker? MessageId in 'headers' looks dangerous as 'headersTruncated' exists
  const ourmessageid = parsedMessage.mail?.headers?.find(h => h.name.toLowerCase() === "message-id")?.value || parsedMessage.mail?.messageId || "";
  const recipient = parsedMessage.mail?.destination[0] || "";

  if (("notificationType" in parsedMessage && parsedMessage.notificationType === "Bounce") || ("eventType" in parsedMessage && parsedMessage.eventType === "Bounce")) {
    return {
      basictype: "bounce",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp: parsedMessage.bounce.timestamp,
        remotemtaip: parsedMessage.bounce.remoteMtaIp || '',
        reportingmta: parsedMessage.bounce.reportingMTA || "",
        feedbackid: parsedMessage.bounce.feedbackId || "",
        ispermanent: parsedMessage.bounce.bounceType === "Permanent",
        bouncetype: parsedMessage.bounce.bounceType,
        bouncesubtype: parsedMessage.bounce.bounceSubType,
        bouncestatus: parsedMessage.bounce.bouncedRecipients[0]?.status || "",
        bounceaction: parsedMessage.bounce.bouncedRecipients[0]?.action || "",
        bouncediagnosticcode: parsedMessage.bounce.bouncedRecipients[0]?.diagnosticCode || "",
        bounceemailaddress: parsedMessage.bounce.bouncedRecipients[0]?.emailAddress || ""
      }
    };
  }
  if (("notificationType" in parsedMessage && parsedMessage.notificationType === "Complaint") || ("eventType" in parsedMessage && parsedMessage.eventType === "Complaint")) {
    return {
      basictype: "complaint",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp: parsedMessage.complaint.timestamp,
        remotemtaip: "",
        reportingmta: "",
        useragent: parsedMessage.complaint.userAgent || "",
        feedbackid: parsedMessage.complaint.feedbackId || "",
        complainedemailaddress: parsedMessage.complaint.complainedRecipients[0]?.emailAddress || "",
        complaintfeedbacktype: parsedMessage.complaint.complaintFeedbackType || ""
      }
    };
  }
  if (("notificationType" in parsedMessage && parsedMessage.notificationType === "Delivery") || ("eventType" in parsedMessage && parsedMessage.eventType === "Delivery")) {
    return {
      basictype: "delivery",
      ourmessageid,
      recipient,
      basicobject: {
        timestamp: parsedMessage.delivery.timestamp,
        remotemtaip: parsedMessage.delivery.remoteMtaIp,
        reportingmta: parsedMessage.delivery.reportingMTA || "",
        feedbackid: "",
        smtpresponse: parsedMessage.delivery.smtpResponse || ""
      }
    };
  }

  return { basictype: "", basicobject: null, ourmessageid, recipient };
}
