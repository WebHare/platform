import type { ResponseBuilder } from "@webhare/router";
import type { WebDesignGetDataFunction } from "@webhare/router/src/siterequest";

export async function getBaseTestJSDesign(builder: ResponseBuilder) {
  const pageConfig = {
    whfspath: builder.targetObject.whfsPath,
    contentobjectpath: "FIXME", //are we receiving contentObject yet ?
    navigationobjectpath: "FIXME", //are we receiving navigationobject yet ?
    widget: null,
    wrdauthplugin: null, //FIXME builder.getPlugin("platform:wrdauth")?.getWittyData() || null,
    comments: null,
    sharedblocks: null,
    // , comments := ObjectExists(GetForumPluginForWebdesign(this)) ? PTR GetForumPluginForWebdesign(this)->EmbedComments() : DEFAULT MACRO PTR
    // , sharedblocks := (SELECT AS MACRO PTR ARRAY PTR this->RenderSharedBlock(usewidgets) FROM usewidgets)
    bobimagelink: { link: "FIXME" }// := ObjectExists(bobimage) ? WrapCachedImage(bobimage->GetWrapped(), [ method := "none" ]) : DEFAULT RECORD
  };

  //@ts-expect-error should be detected as invalid
  builder.setFrontendData("webhare_testsuite:basetestjs", { noSuchField: 4343 });
  //this one should work:
  builder.setFrontendData("webhare_testsuite:basetestjs", { notOurAlarmCode: 424242 });
  //@ts-expect-error should be detected as nonexistent
  builder.setFrontendData("webhare_testsuite:nosuchtype", { invalidData: 41 });

  return pageConfig;
}

// validate signatures
getBaseTestJSDesign satisfies WebDesignGetDataFunction;
