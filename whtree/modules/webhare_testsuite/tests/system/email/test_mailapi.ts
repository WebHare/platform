import * as test from "@webhare/test-backend";
import { prepareMail } from "@webhare/services";
import { runInWork } from "@webhare/whdb";

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

test.run([
  "Basics mail APIs",
  testMailAPI
]);
