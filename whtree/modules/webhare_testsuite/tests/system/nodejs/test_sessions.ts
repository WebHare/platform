
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { generateRandomId } from "@webhare/std/platformbased";
import { SingleFileUploader, type UploadInstructions } from "@webhare/frontend/src/upload";
import { createUploadSession, getUploadedFile } from "@webhare/services";
import { buffer } from "node:stream/consumers";


declare module "@webhare/services" {
  interface SessionScopes {
    "webhare_testsuite:testscope": {
      test: number;
      longdata?: string;
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

  test.eq(sessid, await loadlib("mod::system/lib/webserver.whlib").CreateWebSession("testscope", { test: 42 }, { sessionid: sessid, json: true }));
  test.eq({ test: 42 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessid, "testscope"));
  test.eq({ test: 42 }, await services.getSession("testscope", sessid));

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

  //Test overlong data. Ensure it won't be compressed
  const longdata = generateRandomId("base64url", 4096);
  await beginWork();
  await services.updateSession("webhare_testsuite:testscope", sessidscoped, { test: 46, longdata });
  test.eq({ test: 46, longdata }, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  await commitWork();

  test.eq({ test: 46, longdata }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));
  await loadlib("mod::system/lib/webserver.whlib").StoreWebSessionData(sessidscoped, "webhare_testsuite:testscope", { test: 47, longdata });
  test.eq({ test: 47, longdata }, await services.getSession("webhare_testsuite:testscope", sessidscoped));

  await runInWork(() => services.closeSession(sessidscoped));
  test.eq(null, await services.getSession("webhare_testsuite:testscope", sessidscoped));
  test.eq(null, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));
}

async function testUpload() {
  const uploadText = "This is a test!".repeat(4096);
  const uploader = new SingleFileUploader(new File([uploadText], "text.txt", { type: "text/plain" }));

  await beginWork();
  const howToUpload = await createUploadSession(uploader.manifest, { chunkSize: 555 }) satisfies UploadInstructions;
  await commitWork();

  //We get a relative URL that will work in browsers but not in the backend. Resolve relative to our WebHare install
  howToUpload.baseUrl = new URL(howToUpload.baseUrl, services.backendConfig.backendURL).href;
  const uploadResult = await uploader.upload(howToUpload);

  //Retrieve the file using JS
  const fileInJS = await getUploadedFile(uploadResult.token);
  test.eqPartial({ fileName: "text.txt", size: uploadText.length, mediaType: "text/plain" }, fileInJS);
  test.assert(fileInJS.stream, "File has a stream");
  test.eq(uploadText, (await buffer(fileInJS.stream)).toString());

  //Retrieve the file using HS
  const fileInHS = await loadlib("mod::system/lib/webserver.whlib").GetUploadedFile(uploadResult.token);
  test.eqPartial({ filename: "text.txt", mimetype: "text/plain" }, fileInHS);
  test.eq(uploadText, (await loadlib("wh::files.whlib").BlobToString(fileInHS.data)).toString());
}

test.run(
  [
    testSessionStorage,
    testUpload
  ]);
