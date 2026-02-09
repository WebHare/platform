import { littyToString } from "@webhare/litty";
import { type WebResponse, createWebResponse } from "./response";
import type { CPageRequest, PageBuildRequest } from "./siterequest";
import { createVM, type HSVMObject } from "@webhare/harescript";
import { generateRandomId } from "@webhare/std";


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
