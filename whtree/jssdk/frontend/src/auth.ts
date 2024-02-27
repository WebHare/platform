import { createClient } from "@webhare/jsonrpc-client";

import { NavigateInstruction, navigateTo } from "@webhare/env";

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
