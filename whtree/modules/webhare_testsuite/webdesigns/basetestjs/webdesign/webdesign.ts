import { getTid, getTidLanguage } from "@webhare/gettid";
import type { PageBuildRequest, WebResponse } from "@webhare/router";
import { litty } from "@webhare/litty";
import type { PageBuilderFunction, PagePartRequest, WidgetBuilderFunction } from "@webhare/router/src/siterequest";
import { openFile, whfsType, type TypedInstanceData } from "@webhare/whfs";

export async function renderJSWidget1(partReq: PagePartRequest, data: TypedInstanceData<"webhare_testsuite:base_test.jswidget1">) {
  return litty`<div>${data.field1}</div>`;
}

export async function renderWidgetBlock(partReq: PagePartRequest, data: TypedInstanceData<"http://www.webhare.net/xmlns/webhare_testsuite/rtd/widgetblock">) {
  const subwidgets = [];
  for (const widget of data.widgets) {
    const widgetFile = await openFile(widget);
    //TODO should we have eg 'openWHFSWidget' to shortcircuit building an Instance?
    subwidgets.push(await partReq.renderWidget({ whfsType: widgetFile.type, data: await whfsType(widgetFile.type).get(widgetFile.id) }));
  }
  return litty`<div class="widgetblockwidget">${subwidgets.map(widget => litty`<div class="widgetblockwidget__widget">${widget}</div>`)} </div>`;
}

export async function baseTestJSPageBuilder(req: PageBuildRequest): Promise<WebResponse> {
  //@ts-expect-error should be detected as invalid
  req.setFrontendData("webhare_testsuite:basetestjs", { noSuchField: 4343 });
  //this one should work:
  req.setFrontendData("webhare_testsuite:basetestjs", { notOurAlarmCode: 424242 });
  //@ts-expect-error should be detected as nonexistent
  req.setFrontendData("webhare_testsuite:nosuchtype", { invalidData: 41 });


  const contentobjectpath = "FIXME"; //are we receiving contentObject yet ? do we want it?
  const navigationobjectpath = "FIXME"; //are we receiving navigationobject yet ? do we want it?

  const bobimage = await req.targetSite.openFile("bob.jpg", { allowMissing: true });
  const bobimagelink = bobimage?.data.toResized({ method: "none" });
  const widget = null;

  const wrdauthplugin = await req.getPlugin("platform:wrdauth")?.getWittyData() || null;

  //TODO we want to move away from providing imgroot .. as that one depends on the webdesign designfolder and we might be rendered outside our usual webdesign!
  const imgroot = "FIXME";

  const comments = null; // TODO ObjectExists(GetForumPluginForWebdesign(this)) ? PTR GetForumPluginForWebdesign(this)->EmbedComments() : DEFAULT MACRO PTR
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharedblocks: any[] = []; // TODO sharedblocks := (SELECT AS MACRO PTR ARRAY PTR this->RenderSharedBlock(usewidgets) FROM usewidgets)

  return req.render({
    body: litty`
      <div id="basetitle">${getTid("webhare_testsuite:basetest.title")}</div>
      <div id="whfspath">${req.targetObject.whfsPath}</div>
      <div id="content" data-targetobjectpath="${req.targetObject.whfsPath}"
                        data-contentobjectpath="${contentobjectpath}"
                        data-navigationobjectpath="${navigationobjectpath}"
                        ${getTidLanguage() === 'nl' ? 'data-sitelanguage-nl' : ''}
                        ${getTidLanguage() === 'en' ? 'data-sitelanguage-en' : ''}
                        ${getTidLanguage() === 'ps' ? 'data-sitelanguage-ps' : ''}
                        >
    ${req.content}
    </div>
   ${widget ? litty`<div id="widget">${widget}</div>` : ''}
   ${bobimagelink ? litty`<div id="bobimagelink">${bobimagelink.link}</div>` : ''}
   ${wrdauthplugin ? litty`
      <div id="wrdauthplugin">
        <a id="logoutlink" href="${wrdauthplugin.logoutLink}">Logoutlink</a>
        <a href="${req.targetSite.webRoot}testpages/wrdauthtest/" class="wh-wrdauth__logout">Logout to wrdauthtest</a>
      </div>` : ''}
  ${comments ? litty`<div id="comments">${comments}</div>` : ''}
  ${sharedblocks ? litty`<div id="sharedblocks">${sharedblocks.map((block: string) => litty`<div class="basetest__sharedblock">${block}</div>`)}</div>` : ''}
  <img id="smallbob" src="${imgroot}smallbob.jpg">`
  });
}

baseTestJSPageBuilder satisfies PageBuilderFunction;
//@ts-expect-error FIXME why doesn't this work? need to investigate the typings
renderJSWidget1 satisfies WidgetBuilderFunction;
