import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { generateRandomId, Money } from "@webhare/std";
import { SingleFileUploader, type UploadInstructions } from "@webhare/upload";
import { createUploadSession, getUploadedFile } from "@webhare/services";
import { existsSync } from "fs";
import { getStorageFolderForSession } from "@webhare/services/src/sessions";


declare module "@webhare/services" {
  interface SessionScopes {
    "webhare_testsuite:testscope": {
      test: number;
      longdata?: string;
      amount?: Money;
    };
  }
}

async function testSessionStorage() {
  const f = false;
  if (f) {
    //@ts-expect-error -- bla is not acceptable:
    await services.createServerSession("webhare_testsuite:testscope", { bla: 42 });
  }

  const sessid = await loadlib("mod::system/lib/webserver.whlib").CreateWebSession("testscope", { test: 42 });
  test.eq({ test: 42 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessid, "testscope"));
  await test.throws(/json:/, services.getServerSession("testscope", sessid), "Trying to not to have to include HSON encoders just for sessions");

  test.eq(sessid, await loadlib("mod::system/lib/webserver.whlib").CreateWebSession("testscope", { test: 42, amount: new Money("3.333") }, { sessionid: sessid, json: true }));
  test.eq({ test: 42, amount: new Money("3.333") }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessid, "testscope"));
  test.eq({ test: 42, amount: new Money("3.333") }, await services.getServerSession("testscope", sessid));

  await beginWork();
  const sessidany = await services.createServerSession("webhare_testsuite:undeclaredscope", { test: "Unchecked" });
  const sessidscoped = await services.createServerSession("webhare_testsuite:testscope", { test: 43, amount: new Money("2.33") });
  const sessidexpired = await services.createServerSession("webhare_testsuite:testscope", { test: 43 }, { expires: 1 });

  test.eq(sessidany, await services.createServerSession("webhare_testsuite:undeclaredscope", { test: "Reused" }, { sessionId: sessidany }));
  test.eq({ test: "Reused" }, await services.getServerSession("webhare_testsuite:undeclaredscope", sessidany));
  await commitWork();

  await test.sleep(1); //or at least until a tick has passed and Date.now actually increas
  test.eq(null, await services.getServerSession("webhare_testsuite:testscope", sessidexpired));
  test.eq(null, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidexpired, "webhare_testsuite:undeclaredscope"));

  await test.throws(/Incorrect scope/, services.getServerSession("webhare_testsuite:wrongscope", sessidany));
  test.eq({ test: "Reused" }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidany, "webhare_testsuite:undeclaredscope"));

  test.eq({ test: 43, amount: new Money("2.33") }, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 43, amount: new Money("2.33") }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  await beginWork();
  await services.updateServerSession("webhare_testsuite:testscope", sessidscoped, { test: 44 });
  await commitWork();

  test.eq({ test: 44 }, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 44 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  await loadlib("mod::system/lib/webserver.whlib").StoreWebSessionData(sessidscoped, "webhare_testsuite:testscope", { test: 45 });

  test.eq({ test: 45 }, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));
  test.eq({ test: 45 }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));

  //Test overlong data. Ensure it won't be compressed
  const longdata = generateRandomId("base64url", 4096);
  await beginWork();
  await services.updateServerSession("webhare_testsuite:testscope", sessidscoped, { test: 46, longdata });
  test.eq({ test: 46, longdata }, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));
  await commitWork();

  test.eq({ test: 46, longdata }, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));
  await loadlib("mod::system/lib/webserver.whlib").StoreWebSessionData(sessidscoped, "webhare_testsuite:testscope", { test: 47, longdata });
  test.eq({ test: 47, longdata }, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));

  await runInWork(() => services.closeServerSession(sessidscoped));
  test.eq(null, await services.getServerSession("webhare_testsuite:testscope", sessidscoped));
  test.eq(null, await loadlib("mod::system/lib/webserver.whlib").GetWebSessionData(sessidscoped, "webhare_testsuite:testscope"));
}

async function testUpload() {
  //The WebHare upload flow in a nutshell:
  //The client has a file to upload. It creates a manifest and sends it to the server. The client's not allowed to actually upload anything yet!
  const uploadText = "This is a test!".repeat(4096);
  const uploader = new SingleFileUploader(new File([uploadText], "text.txt", { type: "text/plain" }));

  //The server should have an API accepting a manifest, calling createUploadSession and then returning the instructions to the client
  await beginWork();
  const howToUpload = await createUploadSession(uploader.manifest, { chunkSize: 555 }) satisfies UploadInstructions;
  await commitWork();

  //We get a relative URL that will work in browsers but not in the backend. Resolve relative to our WebHare install so we have an absolute URL for the client
  howToUpload.baseUrl = new URL(howToUpload.baseUrl, services.backendConfig.backendURL).href;

  //The client receives the (updated) UploadInstructions and can now start uploading the file. It will receive a token to identify the upload
  const uploadResult = await uploader.upload(howToUpload);

  //The server receives the token from the client and passes it to getUploadedFile to get the actual file
  const fileInJS = await getUploadedFile(uploadResult.token);
  test.eq("text.txt", fileInJS.name);
  test.eq(uploadText.length, fileInJS.size);
  test.eq("text/plain", fileInJS.type);
  test.assert("File has a stream", await fileInJS.text());

  //Note that we can find the storage on disk
  test.eq(true, existsSync(getStorageFolderForSession(howToUpload.sessionId)));

  //Cleanup the session to free up upload storage. After this getUploadedFile will fail
  await runInWork(() => services.closeServerSession(howToUpload.sessionId));

  //Storage should be gone eventually (the cleanup is async in JS)
  await test.wait(() => !existsSync(getStorageFolderForSession(howToUpload.sessionId)));

  //Ensure constructing as blob assigns the name 'upload' and correctly determines type and size
  const uploaderBlob = new SingleFileUploader(new Blob([uploadText], { type: "text/plain" }));
  test.eq(uploadText.length, uploaderBlob.manifest.files[0].size);
  test.eq("upload", uploaderBlob.manifest.files[0].name);
  test.eq("text/plain", uploaderBlob.manifest.files[0].type);
}

async function testUploadHSCompat() {
  const uploadText = "This is another test!".repeat(4096);
  const uploader = new SingleFileUploader(new File([uploadText], "text.txt", { type: "text/plain" }));

  await beginWork();
  const howToUpload = await createUploadSession(uploader.manifest, { chunkSize: 555 }) satisfies UploadInstructions;
  await commitWork();

  //We get a relative URL that will work in browsers but not in the backend. Resolve relative to our WebHare install
  howToUpload.baseUrl = new URL(howToUpload.baseUrl, services.backendConfig.backendURL).href;
  const uploadResult = await uploader.upload(howToUpload);

  //Retrieve the file using HS
  const fileInHS = await loadlib("mod::system/lib/webserver.whlib").GetUploadedFile(uploadResult.token);
  test.eqPartial({ filename: "text.txt", mimetype: "text/plain" }, fileInHS);
  test.eq(uploadText, (await loadlib("wh::files.whlib").BlobToString(fileInHS.data)).toString());

  //Note that we can find the storage on disk
  test.eq(true, existsSync(getStorageFolderForSession(howToUpload.sessionId)));

  //Cleanup the session using HS
  await loadlib("mod::system/lib/webserver.whlib").CloseWebSession(howToUpload.sessionId, "platform:uploadsession");

  //Storage should be gone immediately (the cleanup is sync in HS)
  test.assert(!existsSync(getStorageFolderForSession(howToUpload.sessionId)));
}

test.runTests(
  [
    testSessionStorage,
    testUpload,
    testUploadHSCompat
  ]);
