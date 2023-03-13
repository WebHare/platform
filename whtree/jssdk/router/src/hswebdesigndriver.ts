import { HSVM, HSVMObject, openHSVM } from "@webhare/services/src/hsvm";
import { WebResponse } from "./response";
import { SiteResponse, SiteResponseSettings } from "./sitereponse";
import type { SiteRequest } from "./siterequest";

class HSWebdesignDriver<T extends object> extends SiteResponse<T> {
  hsvm: HSVM;
  webdesign: HSVMObject;

  constructor(hsvm: HSVM, webdesign: HSVMObject, pageconfig: T, siterequest: SiteRequest, settings: SiteResponseSettings) {
    super(pageconfig, siterequest, settings);
    this.hsvm = hsvm;
    this.webdesign = webdesign;
  }

  async finish() {
    const fileswhlib = this.hsvm.loadlib("wh::files.whlib");
    const placeholder = "___PRINTME_PRINTME__" + Math.random();

    //TODO: use less of HS Webdesign and more of 'our' stuff (eg we should be invoking the design's htmlhead and htmlbody ?)
    const printplaceholder = await this.hsvm.createPrintCallback(placeholder);
    const stream = await fileswhlib.createStream();
    const oldoutput = await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(stream);
    await this.webdesign.RunPageWithContents(printplaceholder);
    await this.hsvm.loadlib("wh::system.whlib").redirectOutputTo(oldoutput);
    const page = await fileswhlib.makeBlobFromStream(stream) as Buffer;

    const pagebody = page.toString().replaceAll(placeholder, this.contents);
    const webresponse = new WebResponse;
    webresponse.setBody(pagebody);
    return webresponse;
  }
}

export async function wrapHSWebdesign<T extends object>(request: SiteRequest): Promise<SiteResponse<T>> {
  const hsvm = await openHSVM({ openPrimary: true });

  const siteprofileslib = hsvm.loadlib("mod::publisher/lib/siteprofiles.whlib");
  const webdesign = await siteprofileslib.GetWebDesign(request.targetobject.id) as HSVMObject;
  const pageconfig = await webdesign.get("pageconfig");

  return new HSWebdesignDriver<T>(hsvm, webdesign, pageconfig as T, request, { witty: "", assetpack: "" });
}
