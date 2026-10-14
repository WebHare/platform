/* wts-backend extends @webhare/test-backend with resources that only exist in webhare_testsuite, eg the webhare_testsuite.testsite* sites */
import { WebServer } from "@mod-platform/js/webserver/webserver";
import { whconstant_whfsid_webhare_tests } from "@mod-system/js/internal/webhareconstants";
import { generateRandomId, throwError } from "@webhare/std";
import type { Configuration } from "@mod-platform/js/webserver/webconfig";
import * as test from "@webhare/test-backend";
import * as net from "node:net";
export * from "@webhare/test-backend";
import { loadlib } from "@webhare/harescript";

import { beginWork, commitWork } from "@webhare/whdb";
import { openFileOrFolder, openFolder, openSite, type Site } from "@webhare/whfs";
import { ensureFallbackCertficate } from "@mod-platform/js/webserver/config";
import type { Puppeteer } from "@webhare/deps";
import { allowInsecureRequests, authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge, discovery } from "openid-client";

export class RequestRecorder implements Disposable {
  public urls: URL[] = [];
  private page: Puppeteer.Page;

  constructor(page: Puppeteer.Page) {
    this.page = page;
    page.on('request', this.logUrl);
  }

  private logUrl = (req: Puppeteer.HTTPRequest) => {
    this.urls.push(new URL(req.url()));
  };

  [Symbol.dispose]() {
    this.page.off('request', this.logUrl);
  }
}

export async function runWebHareLoginFlow(page: Puppeteer.Page, options?: { user?: string; rawUser?: string; password?: string; changePasswordTo?: string }) {
  const password = options?.password || test.getUser("sysop").password;
  const loginName = options?.rawUser ?? test.getUser(options?.user || "sysop")?.login ?? throwError(`Login name not found`);
  using recorder = new RequestRecorder(page);

  console.log("Login with %s on %s", loginName, page.url());
  await page.waitForSelector('.wh-wrdauth-login [name=login]');
  await page.type('[name=login]', loginName);
  await page.type('[name=password]', password);
  await page.waitForSelector('.wh-form--allowsubmit'); //make sure form is ready, hopefully this fixes the 'Node is either not clickable or not an Element'  errors pointing to click('button[type=submit]')

  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type=submit]')
  ]);
  if (options?.changePasswordTo) {
    // Wait until the form's JavaScript has enabled submission.
    await page.waitForSelector('.wh-form--allowsubmit #completeaccountpassword-passwordnew');
    await page.type('#completeaccountpassword-passwordnew', options.changePasswordTo);
    await page.type('#completeaccountpassword-passwordrepeat', options.changePasswordTo);
    await page.click('button[type=submit]');

    await page.waitForSelector('[data-wh-form-action="exit"]');
    await Promise.all([
      page.waitForNavigation(),
      page.click('[data-wh-form-action="exit"]')
    ]);
  }

  // Wait for the final navigation above before returning the recorded redirects.
  return recorder.urls;
}

export async function runOpenIDLoginFlow(browser: Puppeteer.Browser, options: {
  metadataUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope?: string;
  nonce?: string;
  pkceCodeVerifier?: string;
  handleConsent?: (page: Puppeteer.Page) => Promise<void>;
}) {
  const config = await discovery(new URL(options.metadataUrl), options.clientId, options.clientSecret, undefined, {
    execute: [allowInsecureRequests]
  });
  const authorizeUrl = buildAuthorizationUrl(config, {
    scope: options.scope ?? "openid email",
    redirect_uri: options.callbackUrl,
    ...options.nonce ? { nonce: options.nonce } : {},
    ...options.pkceCodeVerifier ? {
      code_challenge: await calculatePKCECodeChallenge(options.pkceCodeVerifier),
      code_challenge_method: "S256"
    } : {}
  });

  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setRequestInterception(true);

    const callback = new URL(options.callbackUrl);
    const isCallback = (request: Puppeteer.HTTPRequest) => {
      const url = new URL(request.url());
      return request.isNavigationRequest() && request.frame() === page.mainFrame()
        && url.origin === callback.origin && url.pathname === callback.pathname;
    };
    // Capture the callback without needing a server listening on localhost.
    page.on('request', request => {
      if (isCallback(request))
        void request.respond(request.redirectChain().length ? { body: '' } : { status: 204 });
      else
        void request.continue();
    });

    //We may be redirected straight to the callback if our authorize parameters were invalid. So first check where we end up before we attempt to login
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.goto(authorizeUrl.toString())
    ]);

    if (page.url().startsWith(options.callbackUrl)) { //immediate failure (TODO or prompt=none, add tests for that!)
      const url = new URL(page.url());
      return {
        config: null,
        tokenSet: null,
        error: url.searchParams.get("error"),
        error_description: url.searchParams.get("error_description")
      };
    }

    const [, callbackRequest] = await Promise.all([
      (async () => {
        await runWebHareLoginFlow(page);
        await options.handleConsent?.(page);
      })(),
      page.waitForRequest(isCallback, { timeout: 30000 })
    ]);
    const tokenSet = await authorizationCodeGrant(config, new URL(callbackRequest.url()), {
      expectedNonce: options.nonce,
      pkceCodeVerifier: options.pkceCodeVerifier,
    });
    return { config, tokenSet, error: null, error_description: null };
  } finally {
    await context.close();
  }
}

export const wellKnownHashes = {
  snowbeagleJPG: "eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw",
  emptyFile: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
  portrait6: "Mjzg1xQL52y-ZRHiaHZiQd_nTt3zS3Pyf0Y35VLI2CQ",
  kikkerJPG: "u4HI1_mWV8E0UWndfoBvwsQr4PxwK7pdZLzYjWSw_0Q",
  goudvisPNG: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY"
};

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteHSTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}
export async function getTestSiteJSTemp() {
  return await openFolder("site::webhare_testsuite.testsitejs/tmp");
}
async function getTestSite(name: string): Promise<Site & { webRoot: string }> {
  const site = await openSite(name);
  if (!site.webRoot)
    throw new Error(`Test site '${name}' is not published`);
  return site as Site & { webRoot: string };
}

export async function getTestSiteHS() {
  return await getTestSite("webhare_testsuite.testsite");
}
export async function getTestSiteJS() {
  return await getTestSite("webhare_testsuite.testsitejs");
}

export async function getWHFSTestRoot() {
  return await openFolder("/webhare-tests/webhare_testsuite.testfolder");
}

export async function resetWTS(options?: test.ResetOptions) {
  await test.reset(options);

  await beginWork();

  for (const tmpfoldername of ["site::webhare_testsuite.testsite/tmp", "site::webhare_testsuite.testsitejs/tmp"]) {
    const tmpfolder = await openFolder(tmpfoldername, { allowMissing: true });
    if (tmpfolder) {
      for (const item of await tmpfolder.list()) {
        //FIXME openObjects would still be very useful
        const obj = await openFileOrFolder(item.id);
        await obj.recycle();
      }
    }
  }

  const testroot = await openFolder(whconstant_whfsid_webhare_tests);
  for (const item of await (await openFolder(whconstant_whfsid_webhare_tests)).list(["parentSite", "modified"])) {
    if (!["webhare_testsuite.testfolder", "webhare_testsuite.testfolder2"].includes(item.name) || !item.isFolder)
      continue; //only clean our own testfolders and only if they turned into a site

    const obj = await openFolder(item.id);
    if (!(await obj.list()).length && !item.parentSite)
      continue; //empty folder

    await obj.recycle();
    await testroot.createFolder(item.name);
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await getTestSiteJS();
  test.assert(testsitejs, "We need the JS testsite to exist");

  if (JSON.stringify(await testsitejs.getWebFeatures()) !== JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() !== "webhare_testsuite:basetestjs") {
    await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await commitWork();
}

async function getAvailableServerPort() {
  //have the OS select a free port
  const server = net.createServer({});
  const listenwaiter = new Promise(resolve => server.once("listening", resolve));
  server.listen({ port: 0, host: "127.0.0.1" });
  await listenwaiter;

  const port = (server.address() as net.AddressInfo).port;
  await new Promise(resolve => server.close(resolve));
  if (!port)
    throw new Error(`Failed to find an available port`);
  return port;
}


export async function createTestWebserverConfig() {
  //Get the fallback certificate so we have a keypair to test with
  const { certPem, keyPem } = await ensureFallbackCertficate();

  const port_http = await getAvailableServerPort();
  const port_https = await getAvailableServerPort();
  const config = (await loadlib("mod::system/lib/internal/webserver/config.whlib").DownloadWebserverConfig()) as Configuration;
  config.ports = [
    {
      port: port_http,
      certificatechain: "",
      ciphersuite: "",
      id: -1,
      ip: "127.0.0.1",
      istrustedport: true,
      keypair: 0,
      privatekey: "",
      virtualhost: true
    },
    {
      port: port_https,
      certificatechain: certPem,
      ciphersuite: "",
      id: -2,
      ip: "127.0.0.1",
      istrustedport: true,
      keypair: 0,
      privatekey: keyPem,
      virtualhost: true
    }
  ];

  return { config, port_http, port_https };
}

export async function getTestWebserver(url: string) {
  const { config } = await createTestWebserverConfig();
  const server = new WebServer("webhare_testsuite:basicrouter_" + generateRandomId().toLowerCase(), { forceConfig: config }); //TODO  et bind: false flags on the cnofig
  server.unref(); //prevent Active resources from keeping us alive after the test finishes
  await server.loadConfig();
  const isSecureBackend = url.startsWith("https://");
  const port = [...server.ports].find(_ => _.port.virtualhost && !isSecureBackend === !_.port.keypair);
  test.assert(port);

  return {
    server,
    clientIp: "127.0.0.1",
    port,
    localAddress: "127.0.0.1:32768"
  };
}
