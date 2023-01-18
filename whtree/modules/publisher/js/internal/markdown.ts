import { SiteRequest, WebResponse } from "@webhare/router";
import { callHareScript } from "@webhare/services/src/services";
import { marked } from 'marked';

export async function renderMarkdown(request: SiteRequest, response: WebResponse) {
  //FIXME we need a JS getInstanceData that gives us nicer Image records with a formatImage or getImageURL or something.. and real blobs
  const markdowninfo = await callHareScript("mod::system/lib/internal/jshelpers.whlib#GetInstanceData", [request.targetobject.id, "http://www.webhare.net/xmlns/publisher/markdownfile"], { openPrimary: true }) as { data: { text: string } } | null;
  if (!markdowninfo?.data?.text)
    return;

  const markdowntext = markdowninfo?.data?.text.toString();
  //FIXME prevent any HTML from leaking through!  maybe some in the future but we still need to Sanitize(Dompurify?) it and/or make it conform to the rtdtype ?
  const html = marked.parse(markdowntext);

  const outputpage = await request.createComposer(response);
  outputpage.appendHTML(html);
  outputpage.flush();
}
