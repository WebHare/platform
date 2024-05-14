import * as dompack from "@webhare/dompack";

class DownloadManager {
  url;
  downloadid;
  cookiename;
  cookieinterval?: number;
  dlframe?: HTMLIFrameElement;
  defer;
  destroyed = false;

  static dlid = 0;

  constructor(url: string) {
    this.url = url;
    this.downloadid = (Math.random().toString().substr(2)) + (++DownloadManager.dlid);
    this.cookiename = "wh-download-" + this.downloadid;
    this.defer = Promise.withResolvers<{
      started: boolean;
      errorinfo: null | unknown;
    }>();
  }

  destroy() {
    if (this.dlframe)
      this.dlframe.remove();

    if (this.cookieinterval) {
      window.clearInterval(this.cookieinterval);
      this.cookieinterval = undefined;
    }

    if (this.defer)
      this.defer.resolve({ started: false, errorinfo: null });
  }

  _cookieCheck() {
    const data = dompack.getCookie(this.cookiename);
    if (!data)
      return;

    dompack.deleteCookie(this.cookiename);
    window.clearInterval(this.cookieinterval);
    this.cookieinterval = undefined;

    if (this.destroyed)
      return;

    this.defer.resolve({ started: true, errorinfo: null });
  }

  _onDownloadFailure(errorinfo: unknown) {
    window.clearInterval(this.cookieinterval);
    this.cookieinterval = undefined;

    if (this.destroyed)
      return;

    this.defer.resolve({ started: false, errorinfo });
  }

  startDownload() {
    if (!this.dlframe) {
      const dlurl = this.url + (this.url.indexOf('?') === -1 ? '?' : '&') + 'wh-download=' + this.downloadid;

      this.dlframe = dompack.create("iframe",
        {
          style: { "display": "none" },
          src: dlurl
        });

      //@ts-ignore cleanup this expando hack
      this.dlframe.__whDownloadManagerFailureCallback = (data) => this._onDownloadFailure(data);
      document.body.appendChild(this.dlframe);
      this.cookieinterval = window.setInterval(() => this._cookieCheck(), 100);
    }
    return this.defer.promise;
  }
}

//@ts-ignore cleanup this expando hack
window.__wh_downloadfailurecallback = function (iframe: HTMLIFrameElement, data: unknown) {
  //@ts-ignore cleanup this expando hack
  iframe.__whDownloadManagerFailureCallback(data);
};

export default DownloadManager;
