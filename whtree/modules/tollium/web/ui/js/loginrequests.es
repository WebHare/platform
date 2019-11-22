import JSONRPC from '@mod-system/js/net/jsonrpc';

function processLoginRequestMessage(event)
{
  let msg = event.data;
  if(!(msg.type && msg.type == "wrd:loginrequest"))
    return;

  //TODO share service with shell?
  new JSONRPC().request('ExecuteLoginChallenge', [msg], result =>
    {
      event.source.postMessage({type: "wrd:loginresponse", submitinstruction:result}, event.origin);
    }, error =>
    {
      console.error("error",error);
    });
}

window.addEventListener("message", processLoginRequestMessage);
