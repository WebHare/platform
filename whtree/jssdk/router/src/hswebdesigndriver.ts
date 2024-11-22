import { WebResponse, createWebResponse } from "./response";
import { InsertPoints, SiteResponse, SiteResponseSettings } from "./sitereponse";
import type { SiteRequest } from "./siterequest";
import { createVM, type HSVMWrapper, type HSVMObject } from "@webhare/harescript";
import { generateRandomId } from "@webhare/std";

/* The HSWebdesignDriver:
   - runs the original HareScript design first, with placeholders for insert/body positions
   - invokes the JS page
   - replaces the placeholders in the HS output with the JS output */
class HSWebdesignDriver<T extends object> extends SiteResponse<T> {
  hsvm: HSVMWrapper;
  webDesign: HSVMObject;

  constructor(hsvm: HSVMWrapper, webDesign: HSVMObject, pageConfig: T, siteRequest: SiteRequest, settings: SiteResponseSettings) {
    super(pageConfig, siteRequest, settings);
    this.hsvm = hsvm;
    this.webDesign = webDesign;
  }

  async finish(): Promise<WebResponse> {
    const fileswhlib = this.hsvm.loadlib("wh::files.whlib");
    const placeholder = generateRandomId();

    //TODO: use less of HS Webdesign and more of 'our' stuff (eg we should be invoking the design's htmlhead and htmlbody ?)
    const printplaceholder = placeholder + "__body__";
    const stream = await fileswhlib.createStream();
    const oldoutput = await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(stream);
    for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"])
      await this.webDesign.InsertHTML(placeholder + "__" + insertpoint + "__", insertpoint);

    await this.webDesign.__RunPageWithPrintPlaceholder(printplaceholder);
    await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(oldoutput);
    const page = await fileswhlib.makeBlobFromStream(stream);

    let pagebody = (await page.text()).replaceAll(printplaceholder, () => this.contents);
    for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"] as const) {
      const replacement = this.insertions[insertpoint] ? await this.renderInserts(insertpoint as InsertPoints) : "";
      pagebody = pagebody.replaceAll(placeholder + "__" + insertpoint + "__", () => replacement);
    }

    await this.hsvm[Symbol.asyncDispose]();

    return createWebResponse(pagebody);
  }
}

export async function wrapHSWebdesign<T extends object>(request: SiteRequest): Promise<SiteResponse<T>> {
  const hsvm = await createVM();
  await hsvm.loadlib("mod::system/lib/database.whlib").openPrimary();

  const siteprofileslib = hsvm.loadlib("mod::publisher/lib/siteprofiles.whlib");
  const webDesign = await siteprofileslib.GetWebDesign(request.targetObject.id) as HSVMObject;
  const pageConfig = await webDesign.getPageconfigForJS();

  return new HSWebdesignDriver<T>(hsvm, webDesign, pageConfig as T, request, new SiteResponseSettings);
}
