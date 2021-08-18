// Implements the frontend 'wh check' towl notifications
const JSONRPC = require('@mod-system/js/net/jsonrpc');
import { getTid } from "@mod-tollium/js/gettid";
import * as domencoding from 'dompack/types/text';
import $todd from "@mod-tollium/web/ui/js/support";

let checkservice;
let checkcall = null;
let intervaltimer;
let checkinterval;

function onCheckResponse(success, response)
{
  checkcall = null;
  if(!success)
  {
    console.error("FIXME: Report server unreachable");
  }
  else
  {
    if(!response.privileged)
      return; //we don't have access

    if(response.firstmessage)
    {
      var message =
            { appurl: "system:dashboard"
            , apptarget: null
            , reuse_instance: true
            };

      var messagetext = getTid("tollium:shell.checks.errors", response.numleft, response.firstmessage);

      var notification =
            { id: "system:checks"
            , icon: "tollium:messageboxes/warning"
            , title: domencoding.encodeValue(getTid("tollium:shell.checks.unresolvedissues"))
            , description: domencoding.encodeValue(messagetext)
            , timeout: 0
            , applicationmessage: message
            , persistent: true
            };
      $todd.towl.showNotification(notification);
    }
    else
    {
      $todd.towl.hideNotification("system:checks");
    }
  }
}


function onCheckInterval()
{
  if(checkcall)
    return; //still one pending, skip this call

  if(!checkservice)
    checkservice = new JSONRPC(); //separate RPC channel for checks, as they can take time and shouldn't block StartApplication
  checkcall = checkservice.request('GetCheckResult', [], onCheckResponse.bind(null, true), onCheckResponse.bind(null, false));
}

export function setupWHCheck(setcheckinterval)
{
  if(setcheckinterval > 0 && !checkinterval)
  {
    checkinterval = setcheckinterval;
    onCheckInterval();
    intervaltimer = setInterval(onCheckInterval, checkinterval);
  }
  else if(intervaltimer && setcheckinterval <= 0)
  {
    clearInterval(intervaltimer);
    intervaltimer = 0;
  }
}
