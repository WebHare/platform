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

    let appendto = document.querySelector('head') || document.querySelector('body');
    appendto.appendChild(scripttag);
  });
}
