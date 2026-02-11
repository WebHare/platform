import { littyToString, rawLitty } from "@webhare/litty";
import { type WebResponse, createWebResponse } from "./response";
import type { ContentPageRequest, CPageRequest, PageBuildRequest } from "./siterequest";
import { createVM, type HSVMObject } from "@webhare/harescript";
import { generateRandomId } from "@webhare/std";
import type { CSPDynamicExecution } from "@webhare/whfs/src/siteprofiles";
import type { WebHareBlob } from "@webhare/services";
import type { WebRequest } from "./request";

const hshostComments = true; //enable indicators to verify HS/TS routes taken

type RunPageResult = {
  headers: Array<{ header: string; data: string; always_add: boolean }>;
} & ({
  content: string;
} | {
  sendfile?: WebHareBlob;
});

async function getVariables(webRequest: WebRequest) {
  const vars: Array<{
    name: string;
    value: string;
  }> = [];

  const url = new URL(webRequest.url);
  for (const [key, value] of url.searchParams.entries())
    vars.push({ name: key, value });

  const ctype = webRequest.headers.get("content-type");
  if (ctype?.includes("application/x-www-form-urlencoded") || ctype?.includes("multipart/form-data")) {
    const formdata = await webRequest.formData();
    for (const [key, value] of formdata.entries()) {
      if (typeof value === "string") {
        vars.push({ name: key, value });
      } else {
        //FIXME files
        // vars.push({ name: key, value: "" });
      }
    }
  }
  return vars;
}

export async function runHareScriptPage(contReq: ContentPageRequest, how:
  { dynamicExecution: CSPDynamicExecution } |
  { hsPageObjectType: string } |
  { pageRouter: { funcname: string; funcarg: unknown } }): Promise<WebResponse> {

  const start = Date.now();
  await using hsvm = await createVM();
  let result: RunPageResult;
  if ("dynamicExecution" in how || "pageRouter" in how) {
    if (!contReq.webRequest)
      throw new Error("A dynamic request must have a webRequest");

    const webClientInfo = {
      headers: Array.from(contReq.webRequest.headers.entries()).map(h => ({ field: h[0], value: h[1] })),
      vars: await getVariables(contReq.webRequest),
      method: contReq.webRequest.method,
      url: contReq.webRequest.url.toString(),
      remoteip: contReq.webRequest.clientIp,
      webserver: contReq.webRequest.clientWebServer,
    };
    result = await hsvm.loadlib("mod::platform/lib/internal/hs-pagehost.whlib").RunDynamicHarescriptPage(webClientInfo, how, contReq.targetObject.id);
  } else {
    result = await hsvm.loadlib("mod::platform/lib/internal/hs-pagehost.whlib").RunStaticHarescriptPage(how.hsPageObjectType, contReq.targetObject.id);
  }

  const contentTime = Date.now() - start;
  const statusSetValue = result.headers.find(h => h.header.toLowerCase() === "status")?.data.split(" ")[0];
  const statusCode = statusSetValue ? parseInt(statusSetValue) : 200;

  let response: WebResponse;
  if ("content" in result) {
    const content = hshostComments ? `\n<!-- HS Page Host: ${contReq.targetObject.id}, content=${contentTime} -->\n${result.content}\n<!-- /HS Page Host -->` : result.content;
    response = await contReq.buildWebPage(rawLitty(content)); //FIXME statuscode
  } else {
    response = createWebResponse(result.sendfile, { status: statusCode });
  }

  for (const header of result.headers)
    if (header.header.toLowerCase() !== "status") //handled by statusCode above
      response.headers.set(header.header, header.data);
  if (hshostComments) //some extra timings
    response.headers.set("X-HS-Host", `content=${contentTime.toString()} render=${(Date.now() - start).toString()}`);
  return response;
}

export async function wrapHSWebdesign(request: PageBuildRequest): Promise<WebResponse> {
  const hsvm = await createVM();
  await hsvm.loadlib("mod::system/lib/database.whlib").openPrimary();

  const siteprofileslib = hsvm.loadlib("mod::publisher/lib/siteprofiles.whlib");
  const webDesign = await siteprofileslib.GetWebDesign(request.targetObject.id) as HSVMObject;

  const fileswhlib = hsvm.loadlib("wh::files.whlib");
  const placeholder = generateRandomId();

  //TODO: use less of HS Webdesign and more of 'our' stuff (eg we should be invoking the design's htmlhead and htmlbody ?)
  const printplaceholder = placeholder + "__body__";
  const stream = await fileswhlib.createStream();
  const oldoutput = await hsvm.loadlib("wh::system.whlib").redirectOutputTo(stream);
  for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"])
    await webDesign.InsertHTML(placeholder + "__" + insertpoint + "__", insertpoint);

  await webDesign.__RunPageWithPrintPlaceholder(printplaceholder);
  await hsvm.loadlib("wh::system.whlib").redirectOutputTo(oldoutput);
  const page = await fileswhlib.makeBlobFromStream(stream);

  const pagetext = await littyToString(request.content);
  let pagebody = (await page.text()).replaceAll(printplaceholder, () => pagetext);
  for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"] as const) {
    const replacement = (request as CPageRequest).__insertions[insertpoint]
      ? await littyToString(await (request as CPageRequest).__renderInserts(insertpoint))
      : "";
    pagebody = pagebody.replaceAll(placeholder + "__" + insertpoint + "__", () => replacement);
  }

  await hsvm[Symbol.asyncDispose]();

  return createWebResponse(pagebody);
}
