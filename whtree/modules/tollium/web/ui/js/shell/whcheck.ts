/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

// Implements the frontend 'wh check' towl notifications
const JSONRPC = require('@mod-system/js/net/jsonrpc');
import { getTid } from "@mod-tollium/js/gettid";
import { encodeString } from "@webhare/std";
import { getIndyShell } from '@mod-tollium/web/ui/js/shell';
import $todd from "@mod-tollium/web/ui/js/support";

let checkservice;
let checkcall = null;
let intervaltimer;
let checkinterval;

function onCheckResponse(success, response) {
  checkcall = null;
  if (!success) {
    console.error("FIXME: Report server unreachable");
  } else {
    if (!response.privileged)
      return; //we don't have access

    if (response.firstmessage) {
      const message =
      {
        appurl: "system:dashboard",
        apptarget: null,
        reuse_instance: true
      };

      const messagetext = getTid("tollium:shell.checks.errors", response.numleft, response.firstmessage);

      const notification =
      {
        id: "system:checks",
        icon: "tollium:messageboxes/warning",
        title: encodeString(getTid("tollium:shell.checks.unresolvedissues"), 'attribute'),
        description: encodeString(messagetext, 'attribute'),
        timeout: 0,
        applicationmessage: message,
        persistent: true
      };
      getIndyShell().towl.showNotification(notification);
    } else {
      getIndyShell().towl.hideNotification("system:checks");
    }
  }
}


function onCheckInterval() {
  if (checkcall)
    return; //still one pending, skip this call

  if (!checkservice)
    checkservice = new JSONRPC(); //separate RPC channel for checks, as they can take time and shouldn't block StartApplication
  checkcall = checkservice.request('GetCheckResult', [], onCheckResponse.bind(null, true), onCheckResponse.bind(null, false));
}

export function setupWHCheck(setcheckinterval) {
  if (setcheckinterval > 0 && !checkinterval) {
    checkinterval = setcheckinterval;
    onCheckInterval();
    intervaltimer = setInterval(onCheckInterval, checkinterval);
  } else if (intervaltimer && setcheckinterval <= 0) {
    clearInterval(intervaltimer);
    intervaltimer = 0;
  }
}
