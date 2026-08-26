import type { ApplicationPortalService } from "@mod-tollium/shell/platform/shell";
import { setupOauthRequestHandler } from "@mod-tollium/web/ui/js/apps/oauth-support";
import { loadlib } from "@webhare/harescript";
import { createClient } from "@webhare/jsonrpc-client";
import { rpc } from "@webhare/rpc";

export async function runOauthFlow(user: string, password: string, url: string) {
  const testportal: string = await loadlib("mod::tollium/lib/internal/headlesscontroller.whlib").GetTestTolliumPortalURL();
  let cookieValue = '';

  const authservice = rpc("platform:authservice", {
    baseUrl: testportal, onResponse: (response) => {
      for (const cookie of response.headers.getSetCookie()) {
        cookieValue += cookie.split(';')[0] + '; ';
      }
    }
  });

  const loginRes = await authservice.login(user, password, "webharelogin-testportal", "mac-chrome-1");
  if (!("navigateTo" in loginRes)) {
    console.error("Login failed", loginRes.code, loginRes.error);
    return;
  }

  const tolliumService = createClient<ApplicationPortalService>(testportal, { headers: { cookie: cookieValue } });
  const handler = setupOauthRequestHandler(tolliumService, url);
  if ("error" in handler) {
    console.error("Error setting up OAuth handler", handler.error);
    return;
  }

  const finalUrl = await handler.approve();
  await fetch(finalUrl, { method: "GET" });
}
