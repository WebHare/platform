import * as test from "@webhare/test-backend";
import { prepareMail } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { readFileSync } from "fs";
import { parseSNSMessage } from "@mod-platform/js/email/aws-ses";
import { decodeYAML } from "@mod-platform/js/devsupport/validation";

type SNSTestData = Array<{
  description: string;
  expect: Partial<Awaited<ReturnType<typeof parseSNSMessage>>>;
} & ({
  //Full SNS message
  message: string;
} | {
  //Message we still need to wrap in the SNS boilerplate
  innerMessage: string;
})>;

function wrapSESv2MessageinBoilerplate(message: unknown) {
  return `
      {
      "Type" : "Notification",
      "MessageId" : "00000000-0000-0000-0000-000000000001",
      "TopicArn" : "arn:aws:sns:eu-west-1:0000000000:webhare-mail",
      "Subject" : "Amazon SES Email Event Notification",
      "Message" : ${JSON.stringify(message)},
      "Timestamp" : "2026-02-18T09:41:33.767Z",
      "SignatureVersion" : "1",
      "Signature" : "sig==",
      "SigningCertURL" : "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-7506a1e35b36ef5a444dd1a8e7cc3ed8.pem",
      "UnsubscribeURL" : "https://sns.eu-west-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:eu-west-1:0000000000:webhare-mail:00000000-0000-0000-0000-000000000000"
    }`;
}

async function testSNSParser() {
  for (const [idx, msg] of decodeYAML<SNSTestData>(readFileSync(__dirname + "/data/sns-test-data.yaml", "utf-8")).entries()) {
    if (typeof msg.expect.basicobject?.timestamp === "string")
      msg.expect.basicobject.timestamp = Temporal.Instant.from(msg.expect.basicobject.timestamp);

    // console.log(idx, msg.description);
    const msgBody = "innerMessage" in msg ? wrapSESv2MessageinBoilerplate(msg.innerMessage) : msg.message;
    const result = parseSNSMessage(msgBody);
    test.eqPartial(msg.expect, result, `Failed test case ${idx} (${msg.description})`);
  }
}

async function testMailAPI() {
  await test.throws(/Cannot load/, prepareMail("mod::webhare_testsuite/data/test/system/mailer/nosuchtemplate.html"));

  //this is based on EmbedTest_PrepareMail

  const mail = await prepareMail("mod::webhare_testsuite/data/test/system/mailer/testmail.html");
  // mail.from = "info@beta.webhare.net";
  mail.cc = ["info+2@beta.webhare.net", "info+3@beta.webhare.net"];
  mail.to = ["test-mailapi-1@beta.webhare.net"];
  mail.data = {
    subject: "Onderwerp",
    webhare_ap: "deeper/logo.png",
    alttag: "ALTY"
  };

  await mail.attachResource("mod::webhare_testsuite/data/test/system/mailer/deeper/attachment.txt");

  await runInWork(async () => await mail.queue());

  const themail = await test.waitForEmails("test-mailapi-1@beta.webhare.net", { timeout: 10000 });
  test.eq(1, themail[0].attachments.length);
  test.eq("ik ben een attachment", (new TextDecoder).decode(themail[0].attachments[0].data));
}

test.runTests([
  "SNS parser",
  testSNSParser,
  "Basics mail APIs",
  testMailAPI
]);
