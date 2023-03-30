import { createWebResponse, WebResponse } from "./response";
import type { SiteRequest } from "./siterequest";
import * as services from "@webhare/services";
import { encodeString } from "@webhare/std";

export class SiteResponseSettings {
  assetpack: string = '';
  witty: string = '';
  lang: string = 'en-US';
  htmlclasses: string[] = [];
  htmlprefixes: Record<string, string> = {};
  htmldirection: "ltr" | "rtl" = "ltr";
  htmldataset: Record<string, string> = {};
  pagetitle: string = '';
  pagedescription: string | null = null;
  canonicalurl: string | null = null;
  supportedlanguages: string[] = [];
}

function getDesignRootForAssetPack(assetpack: string): string {
  //Transform an assetpackname, eg 'webhare_testsuite:basetestjs' to its corresponding URL, '/.publisher/sd/webhare_testsuite/basetestjs/'
  return `/.publisher/sd/${assetpack.replace(":", "/")}/`;
}

function encodeAttr(s: string): string {
  return encodeString(s, "attribute");
}

/** SiteResponse implements HTML pages rendered using site configuration from WHFS and site profiles */
export class SiteResponse<T extends object> {
  siterequest: SiteRequest;
  settings: SiteResponseSettings;
  protected contents = "";

  /** The pageconfig. Not protected because we assume that if you know it's type T, its on you if you access it */
  pageconfig: T;

  constructor(pageconfig: T, siterequest: SiteRequest, settings: SiteResponseSettings) {
    this.siterequest = siterequest;
    this.pageconfig = pageconfig;
    this.settings = settings;
  }

  /** Render the contents of the specified witty component (path#component) with the specified data
    Using path:component is a syntax error and will throw if detected
    Resolves when completed. If you're not waiting, don't modify dataobject and any contained objects until the Witty has completed running! */
  //  async addWitty(wittycomponent: string, dataobject?: unknown);

  /** Finish any async additions */
  //  async flush()

  /** Append the specified text */
  appendHTML(text: string) {
    this.contents += text;
  }

  private async generatePage(head: string, body: string, urlpointers: { designroot: string; designcdnroot: string; imgroot: string; siteroot: string }) {
    let page = `<!DOCTYPE html>\n<html lang="${encodeAttr(this.settings.lang)}" dir="${encodeAttr(this.settings.htmldirection)}"`;
    if (this.settings.htmlclasses.length)
      page += ` class="${encodeAttr(this.settings.htmlclasses.join(" "))}"`;
    if (Object.entries(this.settings.htmlprefixes).length)
      page += ` prefix="${encodeAttr(Object.entries(this.settings.htmlprefixes).map(([prefix, namespace]) => `${prefix}: ${namespace}`).join(" "))}"`;
    //FIXME add html dataset, camelcase it
    page += "><head>";
    page += "<meta charset=\"utf-8\">";
    page += `<title>${encodeAttr(this.settings.pagetitle)}</title>`;
    if (this.settings.pagedescription)
      page += `<meta name="description" content="${encodeAttr(this.settings.pagedescription)}">`;
    if (this.settings.canonicalurl)
      page += `<link rel="canonical" href="${encodeAttr(this.settings.canonicalurl)}">`;
    page += head;

    //FIXME this->DoInserts("dependencies-top");
    const finaljsconfig = {
      //FIXME ...this->__jsconfig
      //TODO do we (still) need all these roots?
      siteroot: urlpointers.siteroot,
      site: {}, //FIXME this->__jssiteconfig
      obj: {}, //FIXME this->__jsoobjconfig
      dtapstage: services.config.dtapstage,
      //TODO should we hvae a services.config.islive?
      islive: ["production", "acceptance"].includes(services.config.dtapstage),
      locale: this.settings.lang, //why doesn't JS just get the html lang= ?
      //FIXME do we still want the 5 digit server number? does anyone really use it anyway?
    };
    page += `<script type="application/json" id="wh-config">${JSON.stringify(finaljsconfig)}</script>`;

    //FIXME adhoc bundle support
    const bundlebaseurl = "/.ap/" + this.settings.assetpack.replace(":", ".") + "/";
    console.error(bundlebaseurl);
    /* TODO cachebuster /! support
      IF(cachebuster != "")
        bundlebaseurl := "/!" || EncodeURL(cachebuster) || bundlebaseurl;
    */
    page += `<link rel="stylesheet" href="${encodeAttr(bundlebaseurl)}ap.css">`;
    page += `<script src="${encodeAttr(bundlebaseurl)}ap.js" async></script>`;


    //FIXME this->DoInserts("dependencies-bottom");
    //FIXME
    // IF(Length(this->structuredbreadcrumb) > 0)
    //   this->__PrintStructuredData();

    //FIXME this->_PrintRobotTag();

    //FIXME         this->__PrintHeadFinale(data);

    /*
            IF (this->pvt_renderwidgetpreview)
            {
              data.contents := this->__renderwidgetpreview;

              IF (this->pagewitty->HasComponent("htmlwidgetbody"))
                this->pagewitty->RunComponent("htmlwidgetbody", data);
              ELSE
                this->pagewitty->CallWithScope(data.contents, data);
            }
            ELSE
            {*/

    page += "</head><body>";
    //TODO do we still want body classes? html classes are always a better idea in the end..
    //fIXME this->__PrintBodyOpening();
    page += body;
    //FIXME  this->__PrintBodyFinale(data);
    page += "</body></html>";
    return page;
  }

  getSupportedLanguages(): Record<string, boolean> {
    return Object.fromEntries(this.settings.supportedlanguages.map(lang => [lang, false]));
  }

  async finish(): Promise<WebResponse> {
    const mywitty = await services.loadWittyResource(this.settings.witty); //TODO check/handle errors? or Will It Throw?
    const designroot = getDesignRootForAssetPack(this.settings.assetpack);
    const urlpointers = {
      designroot,
      designcdnroot: designroot, //FIXME
      imgroot: designroot + "img/",
      siteroot: this.siterequest.targetsite.webroot
    };
    const wittydata = {
      //FIXME base on the supported languages or just assume we're going to build a cool proxy
      sitelanguage: this.getSupportedLanguages(),
      //TODO use from CDN if so configured. or should we move it under /.wh/?
      ishomepage: this.siterequest.targetobject.id === this.siterequest.targetfolder.indexdoc && this.siterequest.targetfolder.id === this.siterequest.targetsite.id,
      ...urlpointers,
      ...this.pageconfig,
      contents: () => this.contents //prevent it from being encoded
    };

    const head = mywitty.hasComponent("htmlhead") ? await mywitty.runComponent('htmlhead', wittydata) : "";
    const body = mywitty.hasComponent("htmlbody") ? await mywitty.runComponent('htmlbody', wittydata) : this.contents;
    const page = await this.generatePage(head, body, urlpointers);
    return createWebResponse(page);
  }
}
