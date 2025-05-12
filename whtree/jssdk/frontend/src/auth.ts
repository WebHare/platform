import { createClient } from "@webhare/jsonrpc-client";
import { type NavigateInstruction, navigateTo } from "@webhare/env";
import * as dompack from '@webhare/dompack';
import type { LoginRemoteOptions } from "@webhare/auth/src/identity";
import { rpc } from "@webhare/rpc/src/rpc-client";

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { getFrontendData } from '@webhare/frontend/src/init';

/** WRDAuth configuration */
export interface WRDAuthOptions {
  /** Callback that is invoked after a succesful login. If not set the page will be reloaded. */
  onLogin?: () => Promise<void> | void;
}

interface AuthLocalData {
  expires: Temporal.Instant | Date; //Future WH will changes this to Temporal.Instant (but we don't want to force the polyfill yet)
  userInfo?: object | null;
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

/** Current authoptions. undefined if setupWRDAuth hasn't been invoked yet */
let authOptions: WRDAuthOptions | undefined;

/** Get current login cookie. If empty, wrdauth is not initialized here */
function getCookieName(): string | null {
  const settings = getFrontendData("wrd:auth", { allowMissing: true });
  return settings?.cookiename || null;
}

function getStorageKeyName(): string | null {
  const c = getCookieName();
  return c ? "wh:wrdauth-" + c : null;
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
    refreshLoginStatus();
    if (authOptions?.onLogin) {
      await authOptions.onLogin();
    } else {
      //Reload the page to get the new login status - TODO put this behind a 'login state change' event and allow users to cancel it if they can deal with login/logout on-page
      console.log("Reloading to process the new loggedIn status");
      navigateTo({ type: "reload" });
    }
  } else {
    //FIXME restore the code & data members from old wrdauth
    failLogin(loginresult.error, { code: "unknown", data: "" }, node);
  }
}

function refreshLoginStatus() {
  const loggedIn = isLoggedIn();
  document.documentElement.classList.toggle("wh-wrdauth--isloggedin", loggedIn);
}

/** Return whether a user's currently logged in */
export function isLoggedIn(): boolean {
  const storagekey = getStorageKeyName();
  if (!storagekey)
    return false;

  const data = dompack.getLocal<AuthLocalData>(storagekey);
  if (data?.expires && "toUTCString" in data.expires) //WH5.6 compatibility
    return Boolean(data.expires > new Date());

  return Boolean(data?.expires && (data.expires as Temporal.Instant).epochMilliseconds > Date.now());
}

/** Setup WRDAuth frontend integration */
export function setupWRDAuth(options?: WRDAuthOptions) {
  if (authOptions)
    throw new Error(`Duplicate setupWRDAuth call`);

  authOptions = { ...options };

  dompack.register<HTMLFormElement>('form.wh-wrdauth__loginform', node => {
    node.setAttribute("data-wh-wrdauth-attached", "");
    dompack.addDocEventListener(node, "submit", evt => submitLoginForm(node, evt));
  });
  dompack.register('.wh-wrdauth__logout', node => {
    async function handleLogoutClick(event: Event) {
      dompack.stop(event);
      await logout();
      console.log("Reloading to process the new logged out status");
      navigateTo({ type: "reload" }); //TODO put this behind a 'login state change' event
    }

    dompack.addDocEventListener(node, "click", event => handleLogoutClick(event));
  });

  dompack.onDomReady(() => {
    if ("$wh$wrdauth" in window) {
      console.error("Both setupWRDAuth from @webhare/frontend and @mod-wrd/js/auth are present in this page. Mixing these is not supported!");
    }
  });

  refreshLoginStatus();
}

function failLogin(message: string, response: { code: string; data: string }, form: HTMLFormElement) {
  const evtdetail = {
    message: message,
    code: response.code,
    data: response.data
  };

  const cancelled = !dompack.dispatchCustomEvent(form || document.documentElement, "wh:wrdauth-loginfailed", { bubbles: true, cancelable: true, detail: evtdetail });
  if (!cancelled) {
    //TODO depending on error we may need to change a different field?
    const loginfield = dompack.qR<HTMLInputElement>(form, "input[name=password]");
    loginfield.setCustomValidity(message);
    loginfield.reportValidity();
    loginfield.focus();
  }
}

/** Retrieve userinfo if set by onFrontendUserInfo in your WRDAuth customizer */
export function getUserInfo<T extends object = object>(): T | null {
  const skey = getStorageKeyName();
  if (!skey)
    return null;

  return dompack.getLocal<AuthLocalData>(skey)?.userInfo as T | null;
}

/** Implements the common username/password flows */
export async function login(username: string, password: string, options: LoginOptions = {}): Promise<LoginResult> {
  const cookieName = getCookieName();
  if (!cookieName)
    throw new Error("WRDAuth not initialized, please call setupWRDAuth first and ensure this page has a <wrdauth> rule");

  const result = await rpc("platform:authservice").login(username, password, cookieName, options);

  if ("error" in result)
    return { loggedIn: false, error: result.error };

  //we've logged in!
  dompack.setLocal<AuthLocalData>(getStorageKeyName()!, {
    expires: result.expires,
    userInfo: result.userInfo || null
  });
  return { loggedIn: true };
}

export async function logout() {
  const cookieName = getCookieName();
  if (!cookieName)
    throw new Error("WRDAuth not initialized, please call setupWRDAuth first and ensure this page has a <wrdauth> rule");

  await rpc("platform:authservice").logout(cookieName);
  dompack.setLocal(getStorageKeyName()!, null);
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
