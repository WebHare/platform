//const SocialiteNetwork = require('./socialitenetwork.es');
import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';
const whurl = require('@mod-system/js/internal/url');
//const PreloadableAsset = require('@mod-system/js/preloadable');
var __facebookappid = '';

//ADDME allow on-init callbacks ?

/*
 Events: like          (receives 'url' in event object)
         unlike        (receives 'url' in event object)

  Integrating a like button:
    https://developers.facebook.com/docs/reference/plugins/like/
    <div class="fb-like" data-href="https://[facebook page]" data-send="false" data-layout="button_count" data-width="250" data-show-faces="false"></div>

  Optionally check $wh.FacebookSDK.anyXFBML to see if there are any xfbml buttons and refuse to init if there aren't

*/

let fboptions = null;
let socialitetoken = '';
let fbconfig = whintegration.config["socialite:facebook"];
let ogconfig = document.querySelector('meta[property="fb:app_id"]');
let loaddefer = null;
let isloaded = false;

/** Configure the SDK. You don't need to invoke this function if the siteprofile declares the facebooksdk plugin and sets the appid
 * @param appid Your application ID (required, really)
 * @param options Options
 * @cell(string) options.langcode Language to use, eg nl_NL (default: en_US)
 */
function configure(appid, options)
{
  if(!options)
    options={};

  fboptions = { langcode: 'langcode' in options ? options.langcode : ''
              , xfbml: 'xfbml' in options ? options.xfbml : null
              , autoload: 'autoload' in options ? options.autoload : false
              , setautogrow: 'setautogrow' in options ? options.setautogrow : false
              //if set, use the specified socialite server-side app for logins. works around problems with Chrome on iOS, or IE with mixed security settings
              , redirectloginapp: 'redirectloginapp' in options ? options.redirectloginapp : ''
              , 'version': 'v2.5'
              };
  socialitetoken='';

  if(!fboptions.langcode)
  {
    var lang = document.lang || '';
    fboptions.langcode = {"en":"en_US","nl":"nl_NL","de":"de_DE"}[lang.toLowerCase()];
    if(!fboptions.langcode)
      fboptions.langcode='en_US';
  }

  if (typeof appid != "string")
    console.error("Invalid fb app id:",appid);

  if(__facebookappid && appid)
  {
    if(__facebookappid!=appid) //duplicate init
      throw ("Duplicate facebook initialization (last application id was " + __facebookappid + ", new appid is " + appid);

    return;
  }
  __facebookappid=appid;

  if(options.autoload)
    load();
}

/** Request the SDK to be loaded */
function load()
{
  if(!loaddefer)
  {
    loaddefer = dompack.createDeferred();
    dompack.onDomReady(doLoad);
  }
  return loaddefer.promise;
}
function doLoad()
{
  if(fboptions.xfbml === null)
    fboptions.xfbml = anyXFBML();

  //ADDME ?super(options && (options.redirectloginapp || options.socialiteappid) ? (options.redirectloginapp || options.socialiteappid): '')
  //if(fboptions.autoload)
    //this.onStartPreload();
  if(!document.getElementById('fb-root'))
  {
    var fbroot = document.createElement("div");
    fbroot.id = "fb-root";
    document.body.appendChild(fbroot);
  }

  //we need to delay until the fbAsyncInit
  window.fbAsyncInit = __onInitDone;
  var fburl = "//connect.facebook.net/" + fboptions.langcode + "/all.js";

  var fbscript = document.createElement("script");;
  fbscript.src = fburl;
  fbscript.id = "facebook-jssdk";
  document.querySelectorAll('head,body')[0].appendChild(fbscript);  //could add this to the URL, it seems to avoid the need for FB.init, but where's the documented proof ? #xfbml=1&appId=" + appid
}
function __onInitDone()
{
  var initrec = { xfbml: fboptions.xfbml
                , appId: __facebookappid
              //, version: 'v2.1'
                };

  //backwards compatiblity with old browsers for cross domain communication
  initrec.channelUrl=location.protocol + '//' + location.host + '/tollium_todd.res/socialite/callbacks/fbchannel.html';

  FB.init(initrec);
  FB.Event.subscribe('edge.create', e=>_onEdge(true));
  FB.Event.subscribe('edge.remove', e=>_onEdge(false));
  if (fboptions.setautogrow)
    FB.Canvas.setAutoGrow();

  isloaded=true;
  loaddefer.resolve(true);
  //FIXME this.donePreload(true);
}

function _onEdge(iscreate, likebutton)
{
  if(dompack.debugflags.anl)
    console.log("[anl] FaceBook like " + (iscreate?"added":"removed"), arguments);

  //FIXME TRACK! $wh.track("share",iscreate ? "facebook-like" : "facebook-unlike",likebutton);
  //FIXME EMIT! On what? this.emit(iscreate ? "like" : "unlike");
}


//Execute if FB ready. will invoke immediately if FB is already loaded, to help break popup handlers
function onready(callback)
{
  if(isLoaded())
    callback();
  else
    load().then(callback);
}

/* post to the current user's feed
   @param link URL to share
   @cell options.picture Picture URL
   @cell options.title Name of the post (title of the share)
   @cell options.caption Caption (use 'www.yoursite.nl' by convention)
   @cell options.text Text to use for the share
   @cell options.onSuccess Callback to invoke on succesful share
   @cell options.onFailure Callback to invoke on a failed share
*/
function startShare(link, options)
{
  if (!options)
    options = {};

  var shareobj = {method: 'feed'};
  if(link)
    shareobj.link = whurl.resolveToAbsoluteURL(location.href,link);
  if(options.picture)
    shareobj.picture = whurl.resolveToAbsoluteURL(location.href, options.picture);
  if(options.title)
    shareobj.name=options.title;
  if(options.text)
    shareobj.description=options.text;

  if(options.caption)
  {
    shareobj.caption=options.caption;
  }
  else if(link) //extract caption from the link
  {
    var linktoks=link.split('/'); //http://site.com/xyz
    if(linktoks.length>=3)
      shareobj.caption = linktoks[2];
  }

  if (options.to)
    shareobj.to = options.to;

  return new Promise( (resolve,reject) =>
  {
    onready( () =>
    {
      FB.ui(shareobj, (response)=>
      {
        if(response && response.post_id)
        {
          resolve(response.post_id)
        }
        else
        {
          reject(new Error("Post failed"));
        }
      });
    });
  });
}

/* Start the feed dialog
   See also https://developers.facebook.com/docs/sharing/reference/feed-dialog/v2.5
   */
function launchFeedDialog(link, options)
{
  options = { method: 'feed'
            , link: link
            , ...options
            };

  return new Promise( (resolve,reject) =>
  {
    onready( () =>
    {
      FB.ui(options, (response)=>
      {
        if(response && response.post_id)
        {
          resolve(response.post_id)
        }
        else
        {
          reject(new Error("Post failed"));
        }
      });
    });
  });
}

function login(options)
{
  return new Promise( (resolve, reject) =>
  {
    try
    {
      openLoginDialog( (result) => { result.accepted = true; resolve(result); }
                     , (result) => { result.accepted = false; resolve(result); }
                     , options
                     );
    }
    catch(e)
    {
      reject(e);
    }
  });
}

/* login to facebook
    options: "permissions" (string array)
    usewindow: if initialized as a plugin, use a new window to perform authentication. this works around Chrome/iOS issues and IE cross-zone login issues */
function openLoginDialog(onaccept, ondeny, options) //ADDME autodelay if FB was still loading
{
  if (!__facebookappid)
  {
    console.error("Can not open a Facebook login dialog because no appid was specified to the $wh.FacebookSDK instance")
    return;
  }

  if(options && typeof options.permissions == 'string')
  {
    console.warn("The permissions passed to openLoginDialog should be an Array of Strings");
    options.permissions = options.permissions.split(',');
  }

/* FIXME
  if(fboptions.redirectloginapp || (options && options.usewindow)) //use the default socialite login
  {
    return this.parent(onaccept, ondeny, options);
  }
*/
  var scope='';
  if(options&& options.permissions)
    scope=options.permissions.join(',');

  var loginoptions = { scope: scope
                     , return_scopes: true
                     , ...(options ? options.fboptions : {})
                     };

  //if (options && options.rerequestpermissions) // by default Facebook won't ask a permission again if it was denied last time
  //  loginoptions.auth_type = "rerequest";

  if(dompack.debugflags.anl)
    console.log("[facebook] Invoking Facebook login",loginoptions);
  FB.login(response => __handleLoginResult(onaccept, ondeny, response), loginoptions);
}
function __handleLoginResult(onaccept, ondeny, response)
{
  if(response && response.authResponse)
  {
    /* Authresponse looks like this: except when it doesnt.
      {"status":"connected","authResponse":{"session_key":true,"accessToken":"BAAFA...","expin":"5140713","sig":"...","userID":"...","secret":"IGNORE","expirationTime":1341779235555}}

    2016-06-20. M: to me it looks like:

    { accessToken: "..."
    , expiresIn: ...
    , signedRequest: "..."
    , userID: "..."
    }
    */

    socialitetoken = "tradein:" + response.authResponse.accessToken;
    if(dompack.debugflags.anl)
      console.log("[facebook] Facebook login returned success. response:",response);

    if(onaccept)
      onaccept( { target:this
                , accesstoken: response.authResponse.accessToken
                , socialitetoken: socialitetoken
                , status: response.status
                , userid: response.authResponse ? response.authResponse.userID : ""
                , grantedscopes: response.authResponse
                                 && response.authResponse.grantedScopes
                                 && response.authResponse.grantedScopes != ""
                                      ? response.authResponse.grantedScopes.split(',')
                                      : []
                });
  }
  else
  {
    if(dompack.debugflags.anl)
      console.log("[facebook] Facebook login returned failure. response:",response);
    if(ondeny)
      ondeny({ target: this });
  }
}

function needsRedirectWorkaround()
{
  return navigator.userAgent.contains("CriOS/");
}

function anyXFBML()
{
  return document.querySelectorAll('div.fb-comments').length || document.querySelectorAll('div.fb-like').length;
}

function getSocialiteToken()
{
  return socialitetoken;
}

function isLoaded()
{
  return isloaded;
}

/// autoload
if(fbconfig)
  configure(fbconfig.appid, { socialiteappid: fbconfig.socid });
if(ogconfig)
{
  let ogappid = ogconfig.getAttribute('content');
  if(fbconfig)
  {
    if(ogconfig.appid != fbconfig.appid)
      console.error("The socialite:facebook appid '" + fbconfig.appid + "' does not match the opengraph appid '" + ogappid + "'");
  }
  else
  {
    configure(ogappid);
  }
}

module.exports = { configure: configure
                 , load: load
                 , isLoaded: isLoaded
                 , launchFeedDialog: launchFeedDialog
                 , launchLoginDialog: login
                 , launchShareDialog: startShare
                 , getSocialiteToken: getSocialiteToken
                 , onready: onready
                 };
