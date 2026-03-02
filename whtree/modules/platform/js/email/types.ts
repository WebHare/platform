export type ParsedBounceMessage = {
  basictype: "bounce";
  ourmessageid: string;
  recipient: string;
  basicobject: {
    timestamp: Temporal.Instant;
    remotemtaip: string;
    reportingmta: string;
    feedbackid: string;
    ispermanent: boolean;
    bouncetype: string;
    bouncesubtype: string;
    bouncestatus: string;
    bounceaction: string;
    bouncediagnosticcode: string;
    bounceemailaddress: string;
  };
} | {
  basictype: "complaint";
  ourmessageid: string;
  recipient: string;
  basicobject: {
    timestamp: Temporal.Instant;
    remotemtaip: string;
    reportingmta: string;
    useragent: string;
    feedbackid: string;
    complainedemailaddress: string;
    complaintfeedbacktype: string;

  };
} | {
  basictype: "delivery";
  ourmessageid: string;
  recipient: string;
  basicobject: {
    timestamp: Temporal.Instant;
    remotemtaip: string;
    reportingmta: string;
    feedbackid: string;
    smtpresponse: string;
  };
} | {
  basictype: string;
  basicobject: null;
  ourmessageid: string;
  recipient: string;
};
