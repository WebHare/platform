import { HSVM, HSVMObject, openHSVM } from "@webhare/services/src/hsvm";
import { WebResponse, createWebResponse } from "./response";
import { InsertPoints, SiteResponse, SiteResponseSettings } from "./sitereponse";
import type { SiteRequest } from "./siterequest";
import { WebHareBlob } from "@webhare/services/src/webhareblob";

/* The HSWebdesignDriver:
   - runs the original HareScript design first, with placeholders for insert/body positions
   - invokes the JS page
   - replaces the placeholders in the HS output with the JS output */
class HSWebdesignDriver<T extends object> extends SiteResponse<T> {
  hsvm: HSVM;
  webDesign: HSVMObject;

  constructor(hsvm: HSVM, webDesign: HSVMObject, pageConfig: T, siteRequest: SiteRequest, settings: SiteResponseSettings) {
    super(pageConfig, siteRequest, settings);
    this.hsvm = hsvm;
    this.webDesign = webDesign;
  }

  async finish(): Promise<WebResponse> {
    const fileswhlib = this.hsvm.loadlib("wh::files.whlib");
    const placeholder = "___PRINTME_PRINTME__" + Math.random();

    //TODO: use less of HS Webdesign and more of 'our' stuff (eg we should be invoking the design's htmlhead and htmlbody ?)
    const printplaceholder = await this.hsvm.createPrintCallback(placeholder + "__body__");
    const stream = await fileswhlib.createStream();
    const oldoutput = await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(stream);
    for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"])
      this.webDesign.InsertHTML(placeholder + "__" + insertpoint + "__", insertpoint);

    await this.webDesign.RunPageWithContents(printplaceholder);
    await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(oldoutput);
    const page = await fileswhlib.makeBlobFromStream(stream) as WebHareBlob;

    let pagebody = (await page.text()).replaceAll(placeholder + "__body__", this.contents);
    for (const insertpoint of ["dependencies-top", "dependencies-bottom", "content-top", "content-bottom", "body-top", "body-bottom", "body-devbottom"]) {
      const replacement = this.insertions[insertpoint as InsertPoints] ? await this.renderInserts(insertpoint as InsertPoints) : "";
      pagebody = pagebody.replaceAll(placeholder + "__" + insertpoint + "__", replacement);
    }

    return createWebResponse(pagebody);
  }
}

export async function wrapHSWebdesign<T extends object>(request: SiteRequest): Promise<SiteResponse<T>> {
  const hsvm = await openHSVM({ openPrimary: true });

  const siteprofileslib = hsvm.loadlib("mod::publisher/lib/siteprofiles.whlib");
  const webDesign = await siteprofileslib.GetWebDesign(request.targetObject.id) as HSVMObject;
  const pageConfig = await webDesign.getPageconfigForJS();

  return new HSWebdesignDriver<T>(hsvm, webDesign, pageConfig as T, request, new SiteResponseSettings);
}
