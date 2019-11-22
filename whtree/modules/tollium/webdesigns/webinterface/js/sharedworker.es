//NOTE: all browsers who supports sharedworkers have native URL support, and the polyfill is incompatible with sharedworkers, so... just don't load
import SocketHandler from "../../../web/ui/js/comm/sockethandler.es";
import SharedWorkerFrontendLink from "../../../web/ui/js/comm/sharedworkerfrontendlink.es";

global.onunhandledrejection = function(e)
{
  console.log(e, e && e.reason && e.reason.stack || "");
};

let url = new URL('/.tollium/ui/comm.whsock', location.href);
url.protocol = url.protocol == 'https:' ? 'wss:' : 'ws:';
let handler = new SocketHandler(url.toString());

handler.run();

// Init the sharedworker onconnect (called when a new client connects)
self.onconnect = function(event)
{
  let port = event.ports[0];
  new SharedWorkerFrontendLink(handler, port);
};
