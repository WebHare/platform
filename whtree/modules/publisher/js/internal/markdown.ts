import { SiteRequest, WebResponse } from "@webhare/router";
import { WebHareBlob, callHareScript } from "@webhare/services";
import MarkdownIt from 'markdown-it';

export async function renderMarkdown(request: SiteRequest): Promise<WebResponse> {
  //FIXME we need a JS getInstanceData that gives us nicer Image records with a formatImage or getImageURL or something.. and real blobs
  const markdowninfo = await callHareScript("mod::system/lib/internal/jshelpers.whlib#GetInstanceData", [request.contentObject.id, "http://www.webhare.net/xmlns/publisher/markdownfile"], { openPrimary: true }) as { data: { text: WebHareBlob } } | null;
  const outputpage = await request.createComposer();
  if (!markdowninfo?.data?.text)
    return outputpage.finish();

  const markdowntext = await markdowninfo?.data?.text.text();
  //FIXME prevent any HTML from leaking through!  maybe some in the future but we still need to Sanitize(Dompurify?) it and/or make it conform to the rtdtype ?
  const md = new MarkdownIt({ linkify: true });
  md.validateLink = (url: string) => true;

  //We will shift headings one level down (TODO might want to make this configurable at some point)
  md.renderer.rules["heading_open"] = (tokens, idx, options, env, self) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    const className = level > 6 ? "normal" : `heading${level}`;
    return `<${tag} class="${className}">`;
  };
  md.renderer.rules["heading_close"] = (tokens, idx, options, env, self) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    return `</${tag}>`;
  };
  md.renderer.rules["paragraph_open"] = (tokens, idx, options, env, self) => {
    return `<p class="normal">`;
  };

  const html = md.render(markdowntext);

  outputpage.appendHTML(html);
  return outputpage.finish();
}
