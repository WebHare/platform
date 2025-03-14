import { type BaseWireMessage, LinkEndpoint } from "@mod-tollium/web/ui/js/comm/linkendpoint";
import type TransportManager from "@mod-tollium/web/ui/js/comm/transportmanager";
import { createClient } from "@webhare/jsonrpc-client";
import * as $todd from '@mod-tollium/web/ui/js/support.ts';
import type { BackendApplication } from "@mod-tollium/web/ui/js/application";
import { emplace } from "@webhare/std";

export type AppSuccessfulStartResponse = {
  status: "ok";
  appdata: {
    /** Initial message */
    data: BaseWireMessage & { status: "appstart" };
    type: "appstart";
  };
  frontendid: string;
  linkid: string;
  appid: string;
};

export type AppStartResponse = AppSuccessfulStartResponse | {
  error: "unexpectedprotocolversion" | "launcherror" | "notloggedin";
  errormessage?: string;
} | {
  type: "expired";
} | {
  errors?: Array<{
    message?: string;
    filename: string;
    line: number;
    col: number;
  }>;
};

class FrontendLink extends LinkEndpoint {
  apps = new Map<string, WeakRef<BackendApplication>>;

  constructor(public shell: TolliumShell, linkid: string, commhost: string, frontendid: string) {
    super({ linkid, commhost, frontendid });
    this.onmessage = this._gotMetaMessage.bind(this) as (msg: unknown) => void;
    this.onclosed = this._gotMetaClose.bind(this, frontendid);
    this.register(this.shell.transportmgr);
  }

  _gotMetaMessage(data: { appid: string } & unknown) { //TODO figure out the rest of metamessage
    const app = this.apps.get(data.appid.substring(2))?.deref(); //these IDs start with "A:"
    if (!app) {
      console.warn("Received error message for app " + data.appid + " but cannot find it", data);
      return;
    }
    app.handleMetaMessage(data);
  }

  _gotMetaClose(linkid: string) {
    $todd.DebugTypedLog('communication', linkid, 'connection closed');

    let openapps = false;
    for (const app of this.apps.values()) {
      if (app.deref()?.handleMetaClose())
        openapps = true;

    }
    this.shell.gotMetaClose(linkid, openapps);
  }
}

interface ApplicationPortalService {
  //TODO: this is just a dummy to get started, we'll write up the rest of the service during the transfer from IndyShell to TolliumShell
  startApp(appname: string, options: unknown): Promise<AppStartResponse>;
}

export default class TolliumShell {
  tolliumservice: ApplicationPortalService;
  frontendlinks = new Map<string, FrontendLink>();
  transportmgr!: TransportManager; //to be further initialized by IndyShell for now (TODO)

  constructor(setup: {
    applicationportal: string;
  }) {
    this.tolliumservice = createClient<ApplicationPortalService>(setup.applicationportal);
  }

  getApplicationById(id: string) {
    for (let i = 0; i < $todd.applications.length; ++i)
      if ($todd.applications[i].whsid === id)
        return $todd.applications[i];
    return null;
  }

  gotMetaClose(linkid: string, openapps: boolean) {
    this.frontendlinks.delete(linkid);
  }

  registerApplicationFrontendLink(app: BackendApplication, data: AppSuccessfulStartResponse, commhost: string) {
    const link = emplace(this.frontendlinks, data.linkid, { insert: () => new FrontendLink(this, data.linkid, commhost, data.frontendid) });
    if (!data.appid)
      throw new Error("No appid in appstart response");

    app.whsid = data.appid; //NOTE also set a bit later when processing appstart ?
    link.apps.set(data.appid, new WeakRef(app));
  }
}
