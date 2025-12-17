// Implements the frontend 'wh check' towl notifications
import { createClient } from "@webhare/jsonrpc-client";

interface CheckResult {
  privileged: boolean;
  firstmessage: string;
  numleft: number;
  any_critical: boolean;
}

interface JSAPIService {
  getCheckResult(path: string): Promise<CheckResult>;
}

const client = createClient<JSAPIService>("system:jsapi");

import { getTid } from "@webhare/gettid";
import { encodeString } from "@webhare/std";
import type IndyShell from '@mod-tollium/web/ui/js/shell';
import type { TowlNotification } from "./towl";
import type { AppLaunchInstruction } from "@mod-platform/js/tollium/types";
import { create, qR } from "@webhare/dompack";

let checkcall: Promise<void> | null = null;
let checkinterval: NodeJS.Timeout | undefined;
let criticalholder: HTMLElement | null = null;

function onCheckFail() {
  checkcall = null;
  setCriticalError(null); //assuming this means a loss of connectivity.
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

  setCriticalError(response.any_critical ? getTid("tollium:shell.criticalissues.dashboard") : null);
}

function setCriticalError(text: string | null) {
  if (text) {
    if (!criticalholder) {
      criticalholder = create("div",
        { class: "wh-shell__criticalissue" },
      );
      document.body.insertBefore(criticalholder, qR(".wh-backend__topbar"));
    }
    criticalholder.textContent = text;
  } else if (criticalholder) {
    criticalholder.remove();
    criticalholder = null;
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
