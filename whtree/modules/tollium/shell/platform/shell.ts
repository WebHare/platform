import { createClient } from "@webhare/jsonrpc-client";

interface ApplicationPortalService {
  //TODO: this is just a dummy to get started, we'll write up the rest of the service during the transfer from IndyShell to TolliumShell
  startPortal(options: unknown): Promise<unknown>;
}

export default class TolliumShell {
  tolliumservice: ApplicationPortalService;

  constructor(setup: {
    applicationportal: string;
  }) {
    this.tolliumservice = createClient<ApplicationPortalService>(setup.applicationportal);
  }

}
