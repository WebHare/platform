import { createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { decryptForThisServer, logDebug } from "@webhare/services";
import { parseSendGridMessage } from "../email/sendgrid";
import { createVM } from "@webhare/harescript";
import { parseSNSMessage } from "../email/aws-ses";


declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "platform:endpoint": {
      type: string;
    };
  }
}

async function handleSendGrid(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);
  const endpointInfo = decryptForThisServer("platform:endpoint", url.searchParams.get("key") || "");
  if (endpointInfo.type !== "sendgrid")
    return createWebResponse("Invalid key", { status: HTTPErrorCode.Unauthorized });

  const body = await req.json() as Array<unknown>;
  logDebug("platform:sendgrid", { url: req.url, headers: Object.fromEntries(req.headers.entries()), body });
  const reports = body.map(msg => parseSendGridMessage(msg)).filter(data => data.basictype); //only pass those where we figured out the type
  for (const bounce of reports) {
    //we need a separate HSVM per bounce as the HS code expects that. fix that for the TS handlers
    await using vm = await createVM();
    await vm.loadlib("mod::system/lib/internal/mail/incoming.whlib").ProcessBounce(bounce);
  }
  return createWebResponse("OK", { status: HTTPSuccessCode.Ok });
}

type AWSMessage = {
  Type: "SubscriptionConfirmation";
  Message: string;
  SubscribeURL: string;
} | {
  Type: "Notification";
};

async function handleAWS_SNS(req: WebRequest): Promise<WebResponse> {
  /* For the JSON format for the generic SNS subscribe/unsubscribe messagess:
    http://docs.aws.amazon.com/sns/latest/dg/json-formats.html

    SES specific example message:
    https://docs.aws.amazon.com/ses/latest/DeveloperGuide/event-publishing-retrieving-sns-examples.html

  */
  const url = new URL(req.url);
  const endpointInfo = decryptForThisServer("platform:endpoint", url.searchParams.get("key") || "");
  if (endpointInfo.type !== "aws-sns")
    return createWebResponse("Invalid key", { status: HTTPErrorCode.Unauthorized });

  const bodyText = await req.text();
  const body = JSON.parse(bodyText) as AWSMessage;
  logDebug("platform:sns", { url: req.url, headers: Object.fromEntries(req.headers.entries()), body });

  //FIXME signature validation. we need to avoid turning into a portscanner or reflector by using SubscriptionConfirmation requests - http://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.verify.signature.html
  //FIXME but validate the URLs hosting the certificate somehow. we don't want that URL to be a portscan opportunity itself
  if (body.Type === "SubscriptionConfirmation") {
    /* Example message.

    "Type" : "SubscriptionConfirmation",
    "MessageId" : "2efaa...",
    "Token" : "233641...",
    "TopicArn" : "arn:aws:sns:eu-west-1:00000:webhare-mail",
    "Message" : "You have chosen to subscribe to the topic arn:aws:sns:eu-west-1:00000:webhare-mail.\nTo confirm the subscription, visit the SubscribeURL included in this message.",
    "SubscribeURL" : "https://sns.eu-west-1.amazonaws.com/...",
    "Timestamp" : "2026-01-07T10:53:42.494Z",
    "SignatureVersion" : "1",
    "Signature" : "A4ZL...",
    "SigningCertURL" : "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-7506a1e35b36ef5a444dd1a8e7cc3ed8.pem"
    */
    if (!body.SubscribeURL)
      throw new Error("Missing SubscribeURL in SubscriptionConfirmation message");
    if (!(new URL(body.SubscribeURL).host).endsWith(".amazonaws.com"))
      throw new Error(`Untrusted subscription host '${new URL(body.SubscribeURL).host}'`);
  }
  if (body.Type !== "Notification") //"other" AWS traffic, ignoring
    return createWebResponse("Unsupported type", { status: HTTPErrorCode.BadRequest });

  const message = parseSNSMessage(bodyText);
  //we need a separate HSVM per bounce as the HS code expects that. fix that for the TS handlers
  await using vm = await createVM();
  await vm.loadlib("mod::system/lib/internal/mail/incoming.whlib").ProcessBounce(message);
  return createWebResponse("OK", { status: HTTPSuccessCode.Ok });
}

export async function endPointRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);

  if (url.pathname === "/.wh/endpoints/sendgrid")
    return await handleSendGrid(req);
  if (url.pathname === "/.wh/endpoints/aws-sns")
    return await handleAWS_SNS(req);

  return createWebResponse("", { status: HTTPErrorCode.NotFound });
}

// validate signatures
endPointRouter satisfies WebHareRouter;
