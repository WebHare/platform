import { littyToString, rawLitty, type Litty } from "@webhare/litty";
import { type WebResponse, createWebResponse } from "./response";
import type { ContentPageRequest, CPageRequest, PageBuildRequest } from "./siterequest";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { appendToArray, generateRandomId, parseTyped, toCamelCase, toCLocaleLowercase } from "@webhare/std";
import type { CSPDynamicExecution } from "@webhare/whfs/src/siteprofiles";
import type { WebHareBlob } from "@webhare/services";
import type { WebRequest } from "./request";
import type { WebHareDBLocation } from "@webhare/services/src/descriptor";
import type { PageBuilderDataTypes } from "@webhare/router";
import type { DataLayerEntry, FrontendDataTypes } from "@webhare/frontend";
import type { ListItem, Thing } from "schema-dts";
import { getCodeContextHSVM } from "@webhare/harescript/src/contextvm";
import type { PageMetadata } from "./metadata";

type RunPageResultCommon = {
  headers: Array<{ header: string; data: string; always_add: boolean }>;
};

/** hs-pagehost.whlib description of a captured page, applied to the ContentPageRequest by setupRequestFromResult  */
export type RunPageResultContent = {
  content: string;
  pagebuilderdata: Array<{ tag: string; data: string }>;
  frontendconfig: Array<{ tag: string; data: string }>;
  opengraph?: {
    admins: string;
    app_id: string;
    description: string;
    image: string;
    site_name: string;
    title: string;
    type: string;
    url: string;
  };
  structured_data: Array<Record<string, unknown> & { "@type": string }>;
  /** DatalayerPush calls. These are not expected to be camelcased during rendering */
  datalayer_pushes: Array<DataLayerEntry>;
  htmlclasses: string[];
  htmldata: Record<string, unknown>;
  canonicalurl: string;
  structuredbreadcrumb: Array<{ link: string; title: string }>;
  pagetitle: string;
  pagedescription: string;
  consiliofields: PageMetadata["consilioFields"];
};

type RunPageResultFile = {
  sendfile: WebHareBlob;
};

type RunPageResult = RunPageResultCommon & (RunPageResultContent | RunPageResultFile);

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

export function setupRequestFromResult(contReq: ContentPageRequest, result: RunPageResultContent) {
  for (const { tag, data } of result.pagebuilderdata)
    contReq.setPageBuilderData(tag.toLowerCase() as keyof PageBuilderDataTypes, toCamelCase(parseTyped(data)) as PageBuilderDataTypes[keyof PageBuilderDataTypes]);
  for (const { tag, data } of result.frontendconfig)
    contReq.setFrontendData(tag.toLowerCase() as keyof FrontendDataTypes, toCamelCase(parseTyped(data)) as FrontendDataTypes[keyof FrontendDataTypes]);
  if (result.opengraph?.description)
    contReq.pageMetadata.openGraph.description = result.opengraph.description;
  if (result.opengraph?.image)
    contReq.pageMetadata.openGraph.image = { url: result.opengraph.image };
  if (result.opengraph?.site_name)
    contReq.pageMetadata.openGraph.siteName = result.opengraph.site_name;
  if (result.opengraph?.title)
    contReq.pageMetadata.openGraph.title = result.opengraph.title;
  if (result.opengraph?.type)
    contReq.pageMetadata.openGraph.type = result.opengraph.type;
  if (result.opengraph?.url)
    contReq.pageMetadata.openGraph.url = result.opengraph.url;
  if (result.structured_data.length)
    appendToArray(contReq.pageMetadata.structuredData, toCamelCase(result.structured_data) as Array<Exclude<Thing, string>>);
  if (result.datalayer_pushes.length)
    appendToArray(contReq.pageMetadata.dataLayer, result.datalayer_pushes);
  if (result.htmlclasses.length)
    appendToArray(contReq.pageMetadata.htmlClasses, result.htmlclasses);
  if (result.htmldata)
    Object.assign(contReq.pageMetadata.htmlDataSet, Object.fromEntries(Object.entries(result.htmldata).map(([k, v]) => [toCLocaleLowercase(k), v])));
  contReq.pageMetadata.canonicalUrl = result.canonicalurl;
  contReq.pageMetadata.breadcrumb.splice(0, contReq.pageMetadata.breadcrumb.length);
  contReq.pageMetadata.breadcrumb.push(...result.structuredbreadcrumb.map(bc => ({ "@type": "ListItem", item: bc.link, name: bc.title } satisfies ListItem)));
  contReq.pageMetadata.title = result.pagetitle;
  contReq.pageMetadata.description = result.pagedescription;
  Object.assign(contReq.pageMetadata.consilioFields, result.consiliofields);
}

export async function runHareScriptPage(contReq: ContentPageRequest, how:
  { dynamicExecution: CSPDynamicExecution } |
  { hsPageObjectType: string } |
  { pageRouter: { funcname: string; funcarg: unknown } }): Promise<WebResponse> {
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

    try {
      const contentObject = (contReq as CPageRequest)["_contentObject"];
      result = await loadlib("mod::platform/lib/internal/hs-pagehost.whlib").RunDynamicHarescriptPage(webClientInfo, how, contReq.targetObject.id, contentObject.id);
    } catch (e) {
      const tv = (await getCodeContextHSVM())?._getHSVM().terminationValue as {
        data: WebHareBlob;
        sendhttpheaders: Array<{
          header: string;
          data: string;
          always_add: boolean;
        }>;
      } | null;

      if (!tv) //It's not a SendWebFile/Redirect
        throw e;

      result = {
        headers: tv.sendhttpheaders,
        sendfile: tv.data
      };
    }
  } else {
    result = await loadlib("mod::platform/lib/internal/hs-pagehost.whlib").RunStaticHarescriptPage(how.hsPageObjectType, contReq.targetObject.id);
  }

  const statusSetValue = result.headers.find(h => h.header.toLowerCase() === "status")?.data.split(" ")[0];
  const statusCode = statusSetValue ? parseInt(statusSetValue) : 200;

  let response: WebResponse;
  if ("content" in result) {
    setupRequestFromResult(contReq, result);
    response = await contReq.buildWebPage(rawLitty(result.content)); //FIXME statuscode
  } else {
    response = createWebResponse(result.sendfile, { status: statusCode });
  }

  for (const header of result.headers)
    if (header.header.toLowerCase() !== "status") //handled by statusCode above
      response.headers.set(header.header, header.data);

  return response;
}

export async function wrapHSWebdesign(request: PageBuildRequest): Promise<WebResponse> {
  const siteprofileslib = loadlib("mod::publisher/lib/siteprofiles.whlib");
  const webDesign = await siteprofileslib.GetWebDesign(request.targetObject.id) as HSVMObject;

  const fileswhlib = loadlib("wh::files.whlib");
  const placeholder = generateRandomId();

  //TODO: use less of HS Webdesign and more of 'our' stuff (eg we should be invoking the design's htmlhead and htmlbody ?)
  const printplaceholder = placeholder + "__body__";
  const stream = await fileswhlib.createStream();
  const oldoutput = await loadlib("wh::system.whlib").redirectOutputTo(stream);
  for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"])
    await webDesign.InsertHTML(placeholder + "__" + insertpoint + "__", insertpoint);

  await webDesign.__RunPageWithPrintPlaceholder(printplaceholder);
  await loadlib("wh::system.whlib").redirectOutputTo(oldoutput);
  const page = await fileswhlib.makeBlobFromStream(stream);

  const pagetext = await littyToString(request.content);
  let pagebody = (await page.text()).replaceAll(printplaceholder, () => pagetext);
  for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"] as const) {
    const replacement = (request as CPageRequest).__insertions[insertpoint]
      ? await littyToString(await (request as CPageRequest).__renderInserts(insertpoint))
      : "";
    pagebody = pagebody.replaceAll(placeholder + "__" + insertpoint + "__", () => replacement);
  }

  return createWebResponse(pagebody);
}

export async function renderHSWidget(request: CPageRequest, widgetType: string, dbLoc: WebHareDBLocation): Promise<{ content: Litty }> {
  const result = await loadlib("mod::platform/lib/internal/hs-pagehost.whlib").RenderHSWidget(request.targetObject.id, widgetType, dbLoc) as { content: string };
  return { content: rawLitty(result.content) };
}
