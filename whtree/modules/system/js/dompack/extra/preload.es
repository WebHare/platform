/* import * as preload from 'dompack/extra/preload' */

export function promiseImage(imgsrc)
{
  return new Promise((resolve, reject) =>
  {
    let img = new Image;
    img.onload = function(evt)
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

export function promiseScript(scriptsrc)
{
  return new Promise((resolve, reject) =>
  {
    let scripttag = document.createElement('script');
    scripttag.onload = function(evt)
    {
      resolve( { node: scripttag
               , src: scripttag.src
               });
    };
    scripttag.onerror = reject;
    scripttag.src = scriptsrc;

    document.querySelector('head,body').appendChild(scripttag);
  });
}

export function promiseCSS(src)
{
  let element = document.createElement('link');
  element.type = 'text/css';
  element.rel = 'stylesheet';
  element.href = src;
  let retval = promiseNewLinkNode(element);

  document.querySelector('head,body').appendChild(element);
  return retval;
}

export function promiseNewLinkNode(element)
{
  return new Promise((resolve, reject) =>
  {
    let r = false;
    element.onload = element.onreadystatechange = function()
    {
      if (!r && (!this.readyState || this.readyState == 'complete')) {
        r = true;
        resolve();
      }
    };
    element.onerror = function(err) {
      reject(err, element);
    };
  });
}

export function promiseAssetPack(apname)
{
  let basepath = `/.ap/${apname.replace(':','.')}/ap.`;
  if(document.querySelector(`script[src$="${CSS.escape(basepath+'js')}"`))
    return; //we have it already

  return Promise.all([promiseScript(basepath+'js'), promiseCSS(basepath+'css')]);
}
