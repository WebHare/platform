/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as test from "@mod-system/js/wh//testframework";

let baseurl;

async function runForumTests(withrecaptcha) {
  test.eq(0, test.qSA(".wh-forumcomments__post").length);

  test.eq('', test.qS("#wh-forumcomments-name").value);
  test.eq('', test.qS("#wh-forumcomments-email").value);
  test.eq('', test.qS("#wh-forumcomments-message").value);

  test.fill("#wh-forumcomments-name", "Pietje");
  test.fill("#wh-forumcomments-email", "pietje@beta.webhare.net");
  test.fill("#wh-forumcomments-message", "De eerste posting");
  test.click("button[type=submit]");

  if (withrecaptcha) {
    await test.wait('ui');
    test.click('.wh-captcha__mock input[type="checkbox"]');
    test.click("button[type=submit]");
  }

  await test.wait('ui');
  test.eq(1, test.qSA(".wh-forumcomments__post").length);

  test.eq('', test.qS("#wh-forumcomments-name").value);
  test.eq('', test.qS("#wh-forumcomments-email").value);
  test.eq('', test.qS("#wh-forumcomments-message").value);

  test.fill("#wh-forumcomments-name", "Jantje");
  test.fill("#wh-forumcomments-email", "Jantje@beta.webhare.net");
  test.fill("#wh-forumcomments-message", "het\ntweede\nbericht");
  test.click("button[type=submit]");

  if (withrecaptcha) {
    await test.wait('ui');
    test.click('.wh-captcha__mock input[type="checkbox"]');
    test.click("button[type=submit]");
  }

  await test.wait('ui');
  test.eq(2, test.qSA(".wh-forumcomments__post").length);

  const messages = test.qSA(".wh-forumcomments__message");
  test.eq(2, messages.length);
  test.eq(2, dompack.qSA(messages[1], "br").length, "There should be two <br>s");
}

test.runTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      const result = await test.invoke('mod::webhare_testsuite/tests/publisher/webtools/forum/forum.whlib#setupTestForum');
      baseurl = result.baseurl;
    },

    "Run standard tests",
    { loadpage: function () { return baseurl + 'forumcomments'; }, waits: ["ui"] },
    () => runForumTests(false),

    "Run with recaptcha",
    { loadpage: function () { return baseurl + 'forumcomments-recaptcha/?wh-debug=nsc'; }, waits: ["ui"] },
    () => runForumTests(true)

  ]);
