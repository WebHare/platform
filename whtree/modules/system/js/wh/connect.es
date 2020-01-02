import fetch from '@mod-system/js/compat/fetch';
import * as dompack from 'dompack';
import { URL } from 'dompack/browserfix/url';
import * as toddrpc from "@mod-tollium/js/internal/todd.rpc.json";

let connectconfig = null;
let shutdown = false;
let errorhandler = null;

export function isJustConnected()
{
  if(shutdown)
    return false;

  let justconnected = connectconfig && connectconfig.justconnected;
  if(justconnected)
    updateConnectConfig({justconnected: false});
  return justconnected;
}
export function hasConnect()
{
  return !!connectconfig;
}
export function getConnectURL()
{
  return connectconfig ? connectconfig.callback : null;
}
//make it async to make sure we can support async updates in the future
async function updateConnectConfig(newconfig)
{
  if(shutdown)
    return;

  connectconfig = {...connectconfig, ...newconfig};
  localStorage.webhareconnect = JSON.stringify(connectconfig);
}
export async function setup(options)
{
  if(options && "onError" in options)
    errorhandler = options.onError;

  let url = new URL(location.href);
  let callback = url.searchParams.get("__webhare_connect__");

  if(callback)
  {
    if(dompack.debugflags.whc)
      console.log(`[whc] connect callback detected:`,callback);

    let newsettings = JSON.parse(callback);
    if(!newsettings.callback || !newsettings.token)
    {
      console.error(`[whc] callback data not understood`);
      return;
    }

    await updateConnectConfig({ callback: newsettings.callback, token:newsettings.token, justconnected: true });

    //remove callback from url
    url.searchParams.delete("__webhare_connect__");
    shutdown = true;
    location.replace(url.toString());
  }
  else
  {
    connectconfig = JSON.parse(localStorage.webhareconnect || 'null');
    if(connectconfig && dompack.debugflags.whc)
      console.log('[whc] WebHare connect is enabled! our callback:', connectconfig.callback);
  }
}
async function openAsset(action, item, data)
{
  if(dompack.debugflags.whc)
    console.log(`[whc] Requesting webdav privileges to '${action}' '${item}'`);

  //Request credentials from the server, then pass them on to the toolkit
  let webdavinfo = await toddrpc.getWebdavOpenInfo(location.pathname, item, data);

  let mounturl = location.href.split('/').slice(0,3).join('/') + '/webdav/';
  if(dompack.debugflags.whc)
  {
    let maskedpassword = webdavinfo.password.replace(/[^-]/g, "*"); //replace all nondashes with *
    console.log(`[whc] Requesting item '${webdavinfo.item}', login '${webdavinfo.login}', password: '${maskedpassword}', url: '${mounturl}'`, webdavinfo.data);
  }
  await postToConnect({ method: 'openAsset'
                      , type: action
                      , item: webdavinfo.item
                      , login: webdavinfo.login
                      , password: webdavinfo.password
                      , data: webdavinfo.data
                      , url: mounturl
                      , localdata: webdavinfo.localdata
                    });
}

export async function postToConnect(msg)
{
  if(dompack.debugflags.whc)
    console.log(`[whc] Posting to connect:`,msg);

  try
  {
    if(!connectconfig || !connectconfig.callback)
      throw new Error("WebHare connect not available");

    let response = await (await fetch(connectconfig.callback + 'connectapi', { method: 'POST', body: JSON.stringify(msg), headers: new Headers({
                            'Content-Type': 'application/json'
                          , 'Authorization': 'Bearer ' + connectconfig.token
                          }) }));
    let json = await response.json();
    if(dompack.debugflags.whc)
      console.log(`[whc] response:`,json);

    if(json&&json.error)
      throw new Error(json.error);

    return json;
  }
  catch(error)
  {
    console.warn("WH Connect failed:", error);
    if(errorhandler)
      errorhandler(error);
    return null;
  }
}

/** @param target File path for the file to open
    @param locationinfo Optional location info within the file
    @cell locationinfo.line Line number
    @cell locationinfo.col Column number
*/
export async function openInEditor(target, locationinfo)
{
  if(dompack.debugflags.whc)
    console.log(`[whc] Requesting open in editor for ${target}`,locationinfo);
  await openAsset('editor', target, locationinfo);
}

export async function revealInFinder(folder)
{
  if(dompack.debugflags.whc)
    console.log(`[whc] Requesting reveal for ${folder}`);
  await openAsset('reveal', folder);
}

//for development,debugging
window.whConnect = { openInEditor
                   , revealInFinder
                   };
