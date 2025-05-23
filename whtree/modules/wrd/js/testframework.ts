import * as test from "@mod-system/js/wh/testframework";
import { throwError } from "@webhare/std";

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
      await runPasswordSetForm(options.email, options.newpassword);
    }
  ];
}

export async function tryLogin(login: string, pwd: string) {
  test.fill(await test.waitForElement("[name=login]"), login);
  test.fill("[name=password]", pwd);
  test.click(await test.waitForElement(["button[type=submit]", 0]));
  await test.wait('ui');
}

export async function runLogin(login: string, pwd: string) {
  await tryLogin(login, pwd);
  await test.wait("load");
}

export async function tryPasswordSetForm(login: string, pwd: string) {
  test.eq(login, (await test.waitForElement(".wh-wrdauth-form [name=login]")).value);
  test.fill(".wh-wrdauth-form [name=passwordnew]", pwd);
  test.fill(".wh-wrdauth-form [name=passwordrepeat]", pwd);
  test.click(await test.waitForElement(".wh-wrdauth-form button[type=submit]"));
  await test.wait('ui');
}

export async function runPasswordSetForm(login: string, pwd: string) {
  await tryPasswordSetForm(login, pwd);

  test.eq(/password has been updated/, test.qR(".wh-form__page--visible").textContent);
  test.click(await test.waitForElement([".wh-form__page[data-wh-form-pagerole=thankyou]", 0, "a[href], button"]) ?? throwError("Login/continue button not found"));
  await test.wait('load');
}
