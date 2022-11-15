/* import * as preload from 'dompack/extra/preload' */

type PromiseImageResult =
{
  node: HTMLImageElement;
  src: string;
  width: number;
  height: number;
};

type PromiseScriptResult =
{
  node: HTMLScriptElement;
  src: string;
};

export function promiseImage(imgsrc: string)
{
  return new Promise<PromiseImageResult>((resolve, reject) =>
  {
    let img = new Image;
    img.onload = () =>
    {
      resolve({node: img
              ,src: img.src
              ,width: img.naturalWidth
              ,height: img.naturalHeight
              });
    };
    img.onerror = reject;
    img.src = imgsrc;
  });
}

export function promiseScript(scriptsrc: string)
{
  return new Promise<PromiseScriptResult>((resolve, reject) =>
  {
    let scripttag = document.createElement('script');
    scripttag.onload = () =>
    {
      resolve( { node: scripttag
               , src: scripttag.src
               });
    };
    scripttag.onerror = reject;
    scripttag.src = scriptsrc;

    document.querySelector('head,body')?.appendChild(scripttag);
  });
}

export function promiseCSS(src: string)
{
  let element = document.createElement('link');
  element.type = 'text/css';
  element.rel = 'stylesheet';
  element.href = src;
  let retval = promiseNewLinkNode(element);

  document.querySelector('head,body')?.appendChild(element);
  return retval;
}

export function promiseNewLinkNode(element: HTMLLinkElement)
{
  return new Promise<void>((resolve, reject) =>
  {
    element.onload = () => resolve();
    element.onerror = reject;
  });
}

export function promiseAssetPack(apname: string)
{
  let basepath = `/.ap/${apname.replace(':','.')}/ap.`;
  if(document.querySelector(`script[src$="${CSS.escape(basepath+'js')}"`))
    return; //we have it already

  return Promise.all([promiseScript(basepath+'js'), promiseCSS(basepath+'css')]);
}
