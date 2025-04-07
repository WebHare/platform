import type { FrontendAuthApi } from "@mod-webhare_testsuite/webdesigns/basetestjs/pages/wrdauthtest";
import * as test from "@webhare/test-frontend";

export async function prepareWRDAuthTest(mailpart: string, options?: { multisite?: boolean; js?: boolean }) {
  const starturl = `${test.getTestSiteRoot()}testpages/wrdauthtest${options?.multisite ? '-multisite' : ''}/`;
  const mailsuffix = `-${mailpart}@beta.webhare.net`;
  const testdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', starturl, mailsuffix, {
    multisite: Boolean(options?.multisite),
    js: Boolean(options?.js)
  }); //executes TestInvoke_SetupWRDAuth
  await test.load(starturl);

  const frontendAuthApi = test.importExposed<FrontendAuthApi>("frontendAuthApi");

  if (frontendAuthApi.isLoggedIn()) {
    await frontendAuthApi.logout();
    await test.load(starturl);
  }

  return {
    formurl: testdata.url,
    starturl,
    mailsuffix
  };
}
