// Implements the frontend 'wh check' towl notifications
import { createClient } from "@webhare/jsonrpc-client";

interface CheckResult {
  privileged: boolean;
  firstmessage: string;
  numleft: number;
}

interface JSAPIService {
  getCheckResult(path: string): Promise<CheckResult>;
}

const client = createClient<JSAPIService>("system:jsapi");

import { getTid } from "@mod-tollium/js/gettid";
import { encodeString } from "@webhare/std";
import IndyShell from '@mod-tollium/web/ui/js/shell';
import type { TowlNotification } from "./towl";
import type { AppLaunchInstruction } from "@mod-platform/js/tollium/types";

let checkcall: Promise<void> | null = null;
let checkinterval: NodeJS.Timeout | undefined;

function onCheckFail() {
  checkcall = null;
}

function onCheckResponse(shell: IndyShell, response: CheckResult) {
  checkcall = null;

  if (!response.privileged)
    return; //we don't have access

  if (response.firstmessage) {
    const message: AppLaunchInstruction = {
      app: "system:dashboard",
      target: null,
      reuse_instance: "never",
      inbackground: false,
      message: null,
      type: "appmessage"
    };

    const messagetext = getTid("tollium:shell.checks.errors", response.numleft, response.firstmessage);

    const notification: TowlNotification = {
      id: "system:checks",
      icon: "tollium:messageboxes/warning",
      title: encodeString(getTid("tollium:shell.checks.unresolvedissues"), 'attribute'),
      description: encodeString(messagetext, 'attribute'),
      timeout: 0,
      applicationmessage: message,
      persistent: true
    };
    shell.towl.showNotification(notification);
  } else {
    shell.towl.hideNotification("system:checks");
  }
}

function onCheckInterval(shell: IndyShell) {
  if (checkcall)
    return; //still one pending, skip this call

  checkcall = client.getCheckResult(location.pathname).then(resp => onCheckResponse(shell, resp), () => onCheckFail());
}

export function setupWHCheck(shell: IndyShell, setcheckinterval: number) {
  if (checkinterval) { //already running
    clearInterval(checkinterval);
    checkinterval = undefined;
  }

  if (setcheckinterval > 0) {
    checkinterval = setInterval(() => onCheckInterval(shell), setcheckinterval);
    onCheckInterval(shell);
  }
}
