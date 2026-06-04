/** Load an image
 * @param imgsrc - The image source URL
 * @returns A promise resolving to the image node
 */
export function loadImage(imgsrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image;
    img.onload = () => {
      resolve(img);
    };
    img.onerror = reject;
    img.src = imgsrc;
  });
}

/** Load a JavaScript file and add it to the DOM
 * @param scriptsrc - The script source URL
 * @param options.module - Load as module
 * @returns A promise resolving to the script node
 */
export function loadScript(scriptsrc: string, options?: { module?: boolean; doc?: Document }): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const doc = options?.doc ?? document;
    const scripttag = doc.createElement('script');
    scripttag.onload = () => {
      resolve(scripttag);
    };
    scripttag.onerror = reject;
    scripttag.src = scriptsrc;
    if (options?.module)
      scripttag.type = "module";

    doc.querySelector('head,body')?.appendChild(scripttag);
  });
}

/** Load a CSS file and add it to the DOM
 * @param src - The CSS source URL
 * @returns A promise resolving to the link node
*/
export function loadCSS(src: string, options?: { doc?: Document }): Promise<HTMLLinkElement> {
  const doc = options?.doc ?? document;
  const element = doc.createElement('link');
  element.type = 'text/css';
  element.rel = 'stylesheet';
  element.href = src;

  const retval = new Promise<HTMLLinkElement>((resolve, reject) => {
    element.onload = () => resolve(element);
    element.onerror = reject;
  });

  doc.querySelector('head,body')?.appendChild(element);
  return retval;
}
