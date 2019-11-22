import * as dompack from "dompack";
import * as cookie from "dompack/extra/cookie.es";


class DownloadManager
{
  constructor(url)
  {
    this.cookieinterval = null;

    this.url = url;
    this.downloadid = (Math.random().toString().substr(2)) + (++DownloadManager.dlid);
    this.cookiename = "wh-download-" + this.downloadid;
  }

  destroy()
  {
    if (this.dlframe)
      dompack.remove(this.dlframe);

    if (this.cookieinterval)
    {
      window.clearInterval(this.cookieinterval);
      this.cookieinterval = null;
    }

    if (this.defer)
      this.defer.resolve({ started: false, errorinfo: null });
  }

  _cookieCheck()
  {
    var data = cookie.read(this.cookiename);
    if(!data)
      return;

    cookie.remove(this.cookiename);
    window.clearInterval(this.cookieinterval);
    this.cookieinterval = null;

    if (this.destroyed)
      return;

    this.defer.resolve({ started: true, errorinfo: null });
  }

  _onDownloadFailure(errorinfo)
  {
    window.clearInterval(this.cookieinterval);
    this.cookieinterval = null;

    if(this.destroyed)
      return;

    this.defer.resolve({ started: false, errorinfo });
  }

  startDownload()
  {
    if (!this.defer)
    {
      this.defer = dompack.createDeferred();
      const dlurl = this.url + (this.url.indexOf('?')==-1 ? '?' : '&') + 'wh-download=' + this.downloadid;

      this.dlframe = dompack.create("iframe",
            { style: { "display":"none" }
            , src: dlurl
            });

      this.dlframe.__whDownloadManagerFailureCallback = (data) => this._onDownloadFailure(data);
      document.body.appendChild(this.dlframe);
      this.cookieinterval = window.setInterval(() => this._cookieCheck(), 100);
    }
    return this.defer.promise;
  }
}

DownloadManager.dlid = 0;
window.__wh_downloadfailurecallback = function(iframe, data)
{
  iframe.__whDownloadManagerFailureCallback(data);
};

export default DownloadManager;
