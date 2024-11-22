import * as test from "@mod-system/js/wh/testframework";

///run forgot password sequence and navigate through the reset procedure
export function testResetPassword(options: { email: string; newpassword: string }) {
  return [
    `Start password reset for ${options.email}`,
    async function () {
      test.fill(test.qR('.wh-wrdauth-forgotpassword input[name="email"]'), options.email);
      test.click(test.qR('.wh-wrdauth-forgotpassword__forgotbutton'));
      await test.waitUI();
    },
    `Handle password reset mail for ${options.email}`,
    async function () {
      const emails = await test.waitForEmails(options.email, { count: 1, timeout: 10000 });
      test.eq(true, emails[0].subject.startsWith("Reset your password for"), "Unexpected subject " + emails[0].subject);

      const resetlink = emails[0].links.filter(link => link.textcontent === "this link")[0];
      test.eq(true, Boolean(resetlink), "Didn't find a reset link");
      test.getWin().location.href = resetlink.href;
      await test.waitNavigation();
    },
    'Set my new password',
    async function () {
      test.fill(test.qR('[name="passwordnew"]'), options.newpassword);
      test.fill(test.qR('[name="passwordrepeat"]'), options.newpassword);
      test.click(test.qR('.wh-wrdauth-resetpassword__resetbutton'));

      await test.waitUI();

      test.click(test.qR(".wh-wrdauth-resetpassword__continuebutton"));
      await test.waitNavigation();
    }
  ];
}
