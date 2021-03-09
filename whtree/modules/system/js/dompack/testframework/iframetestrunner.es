import * as dompack from 'dompack';

export default class IframeTestRunner
{
  constructor()
  {
    document.head.appendChild(dompack.create('style', { textContent:
      `* { box-sizing: border-box; margin: 0; padding: 0 };
      `}));

    this.testframeholder = dompack.create('div');
    document.body.append(this.testframeholder);
  }

  setCurrentWait(waitinfo)
  {
    //document.getElementById('currentwait').textContent = "Wait: pageload";
    //document.getElementById('currentwait').style.display = "inline-block";
    console.log("IframeTestRunner.setCurrentWait", waitinfo);
  }

  startingTest(testname)
  {
    console.log("IframeTestRunner.startingTest", testname);

  //  document.getElementById('stoptests').disabled = "";
  //  document.getElementById('skiptest').disabled = true;
  }

  async loadTestFrame(uri, options)
  {
    options = { loadtimeout: 30000
              , width:1024
              , height:768
              , ...options
            };
    dompack.empty(this.testframeholder);

    let deferred = dompack.createDeferred();
    this.testiframe = dompack.create("iframe", { width: options.width
                                               , height: options.height
                                               , style: { border: "none" }
                                               }); //, { "id": "testframe", "name": "testframe" });
    this.testiframe.addEventListener("load", evt => deferred.resolve(evt));
    this.testiframe.addEventListener("error", evt => deferred.reject(new Error(`Error loading ${uri}`)));
    this.testiframe.src = uri;
    dompack.append(this.testframeholder, this.testiframe);

    setTimeout(() => deferred.reject(new Error(`Timeout loading ${uri}`)), options.loadtimeout);

    await deferred.promise;

    ///FIXME this._rerouteConsole(this.pageframewin);
    //FIXME this._recordAssetpacks(this.pageframewin);

    //Implement focus handling
    /* FIXME
    var focusable = getFocusableComponents(this.pageframedoc.documentElement);
    for (var i=0;i<focusable.length;++i)
    {
      if(focusable[i].autofocus)
      {
        focusable[i].focus();
        break;
      }
    }
*/

    try
    {
      var doctitle = this.getDoc().title;
      if(doctitle == '404 Not found')
        throw new Error("The child frame returned a 404 error, please check the url");
    }
    catch(e)
    {
      if(e.code && e.code == e.SECURITY_ERR)
        this.handleSecurityError();
      throw e;
    }

    if(this.getDoc().id)
      console.error(`Page at ${this.testiframe.contentWindow.location.href} is loading Mootools`);
    if(this.getWin().__dragdroploaded)
      console.error(`Page at ${this.testiframe.contentWindow.location.href} is loading compat/dragdrop.es - we might want to limit that to pure Tollium`);
  }

  getDoc()
  {
    return this.testiframe.contentDocument;
  }
  getWin()
  {
    return this.getDoc().defaultView;
  }
  handleSecurityError()
  {
    dompack.prepend(document.body, dompack.create("div", { style: { position: "absolute", zIndex: 9999, top: 0, background: '#ff0000', padding: '5px'}
                                                         , innerHTML:
                                                           `Unable to access the testing iframe due to a security error<br>
                                                            Please note that file:/// URLs are NOT supported by the dompack
                                                            test framework. You need to arrange for http(s):// hosting of
                                                            the tests to be able to run them`
                                                         }));
  }
}
