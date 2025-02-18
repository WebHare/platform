import { createClient } from "@webhare/jsonrpc-client";
import { type NavigateInstruction, navigateTo } from "@webhare/env";
import * as dompack from '@webhare/dompack';
import type { FrontendLoginResult, FrontendLogoutResult } from "@mod-platform/js/auth/openid";
import type { LoginRemoteOptions } from "@webhare/wrd/src/auth";

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { getFrontendData } from '@webhare/frontend/src/init';

interface AuthLocalData {
  expires: Date;
}

declare module "@webhare/frontend" {
  interface FrontendDataTypes {
    "wrd:auth": {
      /** WRDAuth cookiename (used to verify configuration settings) */
      cookiename: string;
    };
  }
}

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

function getCookieName() {
  const settings = getFrontendData("wrd:auth", { allowMissing: true });
  if (!settings?.cookiename)
    throw new Error("No authsettings.cookiename set, wrd:auth not available");
  return settings.cookiename;
}

function getStorageKeyName() {
  return "wh:wrdauth-" + getCookieName();
}

async function submitLoginForm(node: HTMLFormElement, event: SubmitEvent) {
  dompack.stop(event);

  const username = (node.elements.namedItem("login") as HTMLInputElement)?.value;
  const password = (node.elements.namedItem("password") as HTMLInputElement)?.value;
  const site = (node.elements.namedItem("site") as HTMLInputElement)?.value || undefined;
  const persistentlogin = (node.elements.namedItem("persistent") as HTMLInputElement)?.checked;
  if (!login || !password)
    throw new Error(`submitLoginForm: required elements login/password not set or missing`);

  using lock = dompack.flagUIBusy({ modal: true });
  void (lock);

  const loginresult = await login(username, password, { persistent: persistentlogin, site });
  if (loginresult.loggedIn) {
    //Reload the page to get the new login status - TODO put this behind a 'login state change' event and allow users to cancel it if they can deal with login/logout on-page
    location.reload();
  } else {
    //FIXME restore the code & data members from old wrdauth
    failLogin(loginresult.error, { code: "unknown", data: "" }, node);
  }
}

/** Return whether a user's currently logged in */
export function isLoggedIn(): boolean {
  const data = dompack.getLocal<AuthLocalData>(getStorageKeyName());
  return Boolean(data?.expires && data.expires > new Date());
}

/** Setup WRDAuth frontend integration */
export function setupWRDAuth() {
  dompack.register<HTMLFormElement>('form.wh-wrdauth__loginform', node => {
    node.addEventListener("submit", evt => void submitLoginForm(node, evt));
  });
  dompack.register('.wh-wrdauth__logout', node => {
    async function handleLogoutClick(event: Event) {
      dompack.stop(event);
      await logout();
      location.reload(); //TODO put this behind a 'login state change' event
    }

    node.addEventListener("click", event => void handleLogoutClick(event));
  });

  dompack.onDomReady(() => {
    if ("$wh$wrdauth" in window) {
      console.error("Both @webhare/wrdauth and @mod-wrd/js/auth are present in this page. Mixing these is not supported!");
    }
  });
}

function failLogin(message: string, response: { code: string; data: string }, form: HTMLFormElement | null) {
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
  const data = { username, password, cookieName: getCookieName(), options };
  const result = await (await fetch(`/.wh/openid/frontendservice?type=login&pathname=${encodeURIComponent(location.pathname)}`, {
    method: "post",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(data)
  })).json() as FrontendLoginResult;

  if ("error" in result)
    return { loggedIn: false, error: result.error };

  //we've logged in!
  dompack.setLocal<AuthLocalData>(getStorageKeyName(), { expires: new Date(result.expires) });
  return { loggedIn: true };
}

export async function logout() {
  const data = { cookieName: getCookieName() };
  const result = await (await fetch(`/.wh/openid/frontendservice?type=logout&pathname=${encodeURIComponent(location.pathname)}`, {
    method: "post",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(data)
  })).json() as FrontendLogoutResult;
  if ("error" in result) {
    console.error("Logout failed", result.error);
    return { success: false, error: result.error };
  }

  dompack.setLocal(getStorageKeyName(), null);
  return { success: true };
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
