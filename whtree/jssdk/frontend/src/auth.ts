import { createClient } from "@webhare/jsonrpc-client";
import { NavigateInstruction, navigateTo } from "@webhare/env";
import * as dompack from '@webhare/dompack';
import { frontendConfig } from "./init";
import type { FrontendLoginResult, LoginRemoteOptions } from "@mod-platform/js/auth/openid";

const authsettings = frontendConfig["wrd:auth"] as { cookiename: string } | undefined;

export interface LoginOptions extends LoginRemoteOptions {
}

export type LoginResult = {
  /** Did we log in? */
  loggedIn: true;
} | {
  /** Did we log in? */
  loggedIn: false;
  /** Error message */
  error: string;
};

async function submitLoginForm(this: HTMLFormElement, event: SubmitEvent) {
  dompack.stop(event);

  const username = (this.elements.namedItem("login") as HTMLInputElement)?.value;
  const password = (this.elements.namedItem("password") as HTMLInputElement)?.value;
  const persistentlogin = (this.elements.namedItem("persistent") as HTMLInputElement)?.checked;
  if (!login || !password)
    throw new Error(`submitLoginForm: required elements login/password not set or missing`);

  using lock = dompack.flagUIBusy({ modal: true });
  void (lock);

  const loginresult = await login(username, password, { persistent: persistentlogin });
  if (loginresult.loggedIn) {
    //Reload the page to get the new login status - TODO put this behind a 'login state change' event and allow users to cancel it if they can deal with login/logout on-page
    location.reload();
  } else {
    //FIXME restore the code & data members from old wrdauth
    failLogin(loginresult.error, { code: "unknown", data: "" }, this);
  }
}

/** Setup WRDAuth frontend integration */
export function setupWRDAuth() {
  dompack.register<HTMLFormElement>('form.wh-wrdauth__loginform', node => {
    // node.whplugin_processed = true;
    node.addEventListener("submit", submitLoginForm);
  });
  dompack.onDomReady(() => {
    if ("$wh$wrdauth" in window) {
      console.error("Both @webhare/wrdauth and @mod-wrd/js/auth are present in this page. Mixing these is not supported!");
    }
  });
}

async function failLogin(message: string, response: { code: string; data: string }, form: HTMLFormElement | null) {
  const evtdetail = {
    message: message,
    code: response.code,
    data: response.data
  };

  const cancelled = !dompack.dispatchCustomEvent(form || document.documentElement, "wh:wrdauth-loginfailed", { bubbles: true, cancelable: true, detail: evtdetail });
  if (!cancelled) {
    /*
    if($wh.Popup && $wh.Popup.Dialog)
      new $wh.Popup.Dialog( { text: failevent.message, buttons: [{ result: 'ok', title: "Ok" }] });
    else*/
    // eslint-disable-next-line no-alert
    alert(message);
  }
}


/** Implements the common username/password flows */
export async function login(username: string, password: string, options: LoginOptions = {}): Promise<LoginResult> {
  const data = { username, password, cookieName: authsettings?.cookiename, options };
  const result = await (await fetch(`/.wh/openid/frontendservice?type=login&pathname=${encodeURIComponent(location.pathname)})`, {
    method: "post",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(data)
  })).json() as FrontendLoginResult;

  if ("error" in result)
    return { loggedIn: false, error: result.error };

  //we've logged in! TODO storage updates
  return { loggedIn: true };
}

export interface MyService {
  startLogin2(urlpath: string, tag: string, options: { passive?: boolean }): Promise<NavigateInstruction>;
}

interface SSOLoginOptions {
  passive?: boolean;
}

export async function startSSOLogin(tag: string, options?: SSOLoginOptions): Promise<void> {
  const client = createClient<MyService>("wrd:auth");

  //Launch SSO login for the current page.
  navigateTo(await client.startLogin2(location.pathname + location.search + location.hash, tag, { passive: options?.passive }));
}
