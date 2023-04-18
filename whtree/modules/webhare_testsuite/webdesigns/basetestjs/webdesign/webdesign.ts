import { SiteResponseSettings } from "@webhare/router";
import { WebDesignFunction, SiteRequest, SiteResponse } from "@webhare/router";

export interface BaseTestPageConfig {
  whfspath: string;
  contentobjectpath: string;
  navigationobjectpath: string;
  widget: null;
  wrdauthplugin: null;
  comments: null;
  sharedblocks: null;
  bobimagelink: { link: string };
}

export async function BaseTestJSDesign(request: SiteRequest, settings: SiteResponseSettings) {
  const pageconfig: BaseTestPageConfig = {
    whfspath: request.targetobject.whfspath,
    contentobjectpath: "FIXME", //are we receiving contentobject yet ?
    navigationobjectpath: "FIXME", //are we receiving navigationobject yet ?
    widget: null,
    wrdauthplugin: null,
    comments: null,
    sharedblocks: null,
    // , comments := ObjectExists(GetForumPluginForWebdesign(this)) ? PTR GetForumPluginForWebdesign(this)->EmbedComments() : DEFAULT MACRO PTR
    // , sharedblocks := (SELECT AS MACRO PTR ARRAY PTR this->RenderSharedBlock(usewidgets) FROM usewidgets)
    bobimagelink: { link: "FIXME" }// := ObjectExists(bobimage) ? WrapCachedImage(bobimage->GetWrapped(), [ method := "none" ]) : DEFAULT RECORD
  };
  return new SiteResponse(pageconfig, request, settings);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature. for CI purposes, not needed in external modules
const BaseTestJSDesignValidator: WebDesignFunction<BaseTestPageConfig> = BaseTestJSDesign;
