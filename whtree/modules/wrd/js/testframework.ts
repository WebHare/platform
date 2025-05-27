import * as test from "@mod-system/js/wh/testframework";
import { throwError } from "@webhare/std";

export async function openResetPassword(options: { email: string; verifier?: string; expectLang?: string }) {
  test.subtest(`Start password reset for ${options.email}`);

  test.fill(test.qR('.wh-wrdauth-forgotpassword input[name="email"]'), options.email);
  test.click(test.qR('.wh-wrdauth-forgotpassword__forgotbutton'));
  await test.waitUI();

  test.subtest(`Handle password reset mail for ${options.email}`);

  const emails = await test.waitForEmails(options.email, { count: 1, timeout: 10000 });
  test.eq(options.expectLang?.startsWith('nl') ? /Uw wachtwoord herstellen/ : /Reset your password for/, emails[0].subject, "Unexpected subject " + emails[0].subject);

  const resetlink = emails[0].links.filter(link => link.textcontent === (options.expectLang?.startsWith('nl') ? "deze link" : "this link"))[0];
  test.eq(true, Boolean(resetlink), "Didn't find a reset link");
  test.getWin().location.href = resetlink.href;
  await test.wait('load');

  return { link: resetlink.href };
}

///run forgot password sequence and navigate through the reset procedure
export async function runResetPassword(options: { email: string; newpassword: string; verifier?: string; expectLang?: string; loginAfterReset?: boolean }) {
  await openResetPassword(options);
  test.subtest('Set my new password');
  await runPasswordSetForm(options.email, options.newpassword, { verifier: options.verifier || '', expectLang: options.expectLang, loginAfterReset: options.loginAfterReset });
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

export async function tryPasswordSetForm(login: string, pwd: string, { verifier = "" } = {}) {
  test.eq(login, (await test.waitForElement(".wh-wrdauth-form [name=login]")).value);
  test.fill(".wh-wrdauth-form [name=passwordnew]", pwd);
  test.fill(".wh-wrdauth-form [name=passwordrepeat]", pwd);
  if (verifier)
    test.fill(".wh-wrdauth-form [name=verifier]", verifier);
  else
    test.assert(!test.qS(".wh-wrdauth-form [name=verifier]"), "Verifier field should not be present");

  test.click(await test.waitForElement(".wh-wrdauth-form button[type=submit]"));
  await test.wait('ui');
}

export async function runPasswordSetForm(login: string, pwd: string, { verifier = "", expectLang = "", loginAfterReset = false } = {}) {
  await tryPasswordSetForm(login, pwd, { verifier });

  test.eq(expectLang.startsWith('nl') ? /wachtwoord is bijgewerkt/ : /password has been updated/, test.qR(".wh-form__page--visible").textContent);
  test.click(await test.waitForElement(["button[data-wh-form-action=exit]"]) ?? throwError("Login/continue button not found"));
  await test.wait('load');
  if (loginAfterReset) {
    await runLogin(login, pwd);
  }
}

export async function forceLogout() {
  test.wrdAuthLogout();
  await test.wait("load");
  await test.wait("ui-nocheck");
}
