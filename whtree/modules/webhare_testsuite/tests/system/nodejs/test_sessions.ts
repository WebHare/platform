
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";


declare module "@webhare/services" {
  interface SessionScopes {
    "webhare_testsuite:testscope": {
      test: number;
    };
  }
}

async function testSessionStorage() {
  const f = false;
  if (f) {
    //@ts-expect-error -- bla is not acceptable:
    await services.createSession("webhare_testsuite:testscope", { bla: 42 });
  }

  const sessid = await loadlib("mod::system/lib/webserver.whlib").CreateWebSession("testscope", { test: 42 });
  test.eq({ test: 42 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessid, "testscope"));
  await test.throws(/json:/, services.getSession("testscope", sessid), "Trying to not to have to include HSON encoders just for sessions");

  await loadlib("mod::system/lib/webserver.whlib").CreateWebSession("testscope", { test: 42, sessionid: sessid, json: true });
  test.eq({ test: 42 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessid, "testscope"));
  await test.throws(/json:/, services.getSession("testscope", sessid), "Trying to not to have to include HSON encoders just for sessions");

  await beginWork();
  const sessidany = await services.createSession("webhare_testsuite:undeclaredscope", { test: "Unchecked" });
  const sessidscoped = await services.createSession("webhare_testsuite:testscope", { test: 43 });
  const sessidexpired = await services.createSession("webhare_testsuite:testscope", { test: 43 }, { expires: 1 });

  test.eq(sessidany, await services.createSession("webhare_testsuite:undeclaredscope", { test: "Reused" }, { sessionId: sessidany }));
  test.eq({ test: "Reused" }, await services.getSession("webhare_testsuite:undeclaredscope", sessidany));
  await commitWork();

  await test.sleep(1); //or at least until a tick has passed and Date.now actually increas
  test.eq(null, await services.getSession("webhare_testsuite:testscope", sessidexpired));
  test.eq(null, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidexpired, "webhare_testsuite:undeclaredscope"));

  await test.throws(/Incorrect scope/, services.getSession("webhare_testsuite:wrongscope", sessidany));
  test.eq({ test: "Reused" }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidany, "webhare_testsuite:undeclaredscope"));

  test.eq({ test: 43 }, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 43 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  await beginWork();
  await services.updateSession("webhare_testsuite:testscope", sessidscoped, { test: 44 });
  await commitWork();

  test.eq({ test: 44 }, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 44 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  await loadlib("mod::system/lib/webserver.whlib").StoreWebSessionData(sessidscoped, "webhare_testsuite:testscope", { test: 45 });

  test.eq({ test: 45 }, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 45 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  await runInWork(() => services.closeSession(sessidscoped));
  test.eq(null, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  test.eq(null, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));
}

test.run(
  [ //basic tests
    testSessionStorage,
  ]);
