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
  const pageConfig: BaseTestPageConfig = {
    whfspath: request.targetObject.whfsPath,
    contentobjectpath: "FIXME", //are we receiving contentObject yet ?
    navigationobjectpath: "FIXME", //are we receiving navigationobject yet ?
    widget: null,
    wrdauthplugin: null,
    comments: null,
    sharedblocks: null,
    // , comments := ObjectExists(GetForumPluginForWebdesign(this)) ? PTR GetForumPluginForWebdesign(this)->EmbedComments() : DEFAULT MACRO PTR
    // , sharedblocks := (SELECT AS MACRO PTR ARRAY PTR this->RenderSharedBlock(usewidgets) FROM usewidgets)
    bobimagelink: { link: "FIXME" }// := ObjectExists(bobimage) ? WrapCachedImage(bobimage->GetWrapped(), [ method := "none" ]) : DEFAULT RECORD
  };
  return new SiteResponse(pageConfig, request, settings);
}

// validate signatures
BaseTestJSDesign satisfies WebDesignFunction<BaseTestPageConfig>;
