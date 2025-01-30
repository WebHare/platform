import { loadlib } from "@webhare/harescript";
import type { SiteRequest, WebResponse } from "@webhare/router";
import type { WebHareBlob } from "@webhare/services";
import MarkdownIt from 'markdown-it';

interface RenderEnv {
  inList: boolean;
}

export async function renderMarkdownText(text: string): Promise<string> {
  //FIXME prevent any HTML from leaking through!  maybe some in the future but we still need to Sanitize(Dompurify?) it and/or make it conform to the rtdtype ?
  const md = new MarkdownIt({ linkify: true });
  md.validateLink = (url: string) => true;

  //We will shift headings one level down (TODO might want to make this configurable at some point)
  md.renderer.rules["heading_open"] = (tokens, idx, options, env: RenderEnv, self) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    const className = level > 6 ? "normal" : `heading${level}`;
    return `<${tag} class="${className}">`;
  };
  md.renderer.rules["heading_close"] = (tokens, idx, options, env: RenderEnv, self) => {
    const level = parseInt(tokens[idx].tag[1]) + 1;
    const tag = level > 6 ? "p" : `h${level}`;
    return `</${tag}>`;
  };

  //Alternatively we could have modified the token stream, but we don't pass that to others anyway so for now: just modify the output
  md.renderer.rules["bullet_list_open"] = (tokens, idx, options, env: RenderEnv, self) => {
    env.inList = true;
    if (tokens[idx].level === 0) //back to top level
      return `<ul class="unordered">`;
    else
      return `<ul>`;
  };
  md.renderer.rules["bullet_list_close"] = (tokens, idx, options, env: RenderEnv, self) => {
    if (tokens[idx].level === 0) //back to top level
      env.inList = false;
    return `</ul>`;
  };
  md.renderer.rules["list_item_open"] = (tokens, idx, options, env: RenderEnv, self) => {
    return '<li>';
  };
  md.renderer.rules["list_item_close"] = (tokens, idx, options, env: RenderEnv, self) => {
    return '</li>';
  };
  md.renderer.rules["paragraph_open"] = (tokens, idx, options, env: RenderEnv, self) => {
    //we don't want <p> inside lists (but figure out if we now need to generate softbreaks? or is it more robust to just allow parapgrahs in lists anyway? but then markdown users need to update their CSS)
    if (env.inList)
      return '';
    return `<p class="normal">`;
  };
  md.renderer.rules["paragraph_close"] = (tokens, idx, options, env: RenderEnv, self) => {
    if (env.inList)
      return '';
    return `</p>`;
  };

  const html = md.render(text, {} as RenderEnv);
  return html;
}

export async function renderMarkdown(request: SiteRequest): Promise<WebResponse> {
  //FIXME we need a JS getInstanceData that gives us nicer Image records with a formatImage or getImageURL or something.. and real blobs
  const markdowninfo = await loadlib("mod::system/lib/internal/jshelpers.whlib").GetInstanceData(request.contentObject.id, "http://www.webhare.net/xmlns/publisher/markdownfile") as { data: { text: WebHareBlob } } | null;
  const outputpage = await request.createComposer();
  if (!markdowninfo?.data?.text)
    return outputpage.finish();

  const markdowntext = await markdowninfo?.data?.text.text();
  const html = await renderMarkdownText(markdowntext);
  outputpage.appendHTML(html);
  return outputpage.finish();
}
