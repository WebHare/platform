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

export function promiseImage(imgsrc: string) {
  return new Promise<PromiseImageResult>((resolve, reject) => {
    const img = new Image;
    img.onload = () => {
      resolve({
        node: img,
        src: img.src,
        width: img.naturalWidth,
        height: img.naturalHeight
      });
    };
    img.onerror = reject;
    img.src = imgsrc;
  });
}

export function promiseScript(scriptsrc: string) {
  return new Promise<PromiseScriptResult>((resolve, reject) => {
    const scripttag = document.createElement('script');
    scripttag.onload = () => {
      resolve({
        node: scripttag,
        src: scripttag.src
      });
    };
    scripttag.onerror = reject;
    scripttag.src = scriptsrc;

    document.querySelector('head,body')?.appendChild(scripttag);
  });
}

export function promiseCSS(src: string) {
  const element = document.createElement('link');
  element.type = 'text/css';
  element.rel = 'stylesheet';
  element.href = src;
  const retval = promiseNewLinkNode(element);

  document.querySelector('head,body')?.appendChild(element);
  return retval;
}

export function promiseNewLinkNode(element: HTMLLinkElement) {
  return new Promise<void>((resolve, reject) => {
    element.onload = () => resolve();
    element.onerror = reject;
  });
}
