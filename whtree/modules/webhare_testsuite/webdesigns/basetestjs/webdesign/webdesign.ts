import { type SiteResponseSettings, type WebDesignFunction, type SiteRequest, SiteResponse } from "@webhare/router";

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

  const response = new SiteResponse(pageConfig, request, settings);
  //@ts-expect-error should be detected as invalid
  response.setFrontendData("webhare_testsuite:basetestjs", { noSuchField: 4343 });
  //this one should work:
  response.setFrontendData("webhare_testsuite:basetestjs", { notOurAlarmCode: 424242 });
  //@ts-expect-error should be detected as nonexistent
  response.setFrontendData("webhare_testsuite:nosuchtype", { invalidData: 41 });

  return response;
}

// validate signatures
BaseTestJSDesign satisfies WebDesignFunction<BaseTestPageConfig>;
