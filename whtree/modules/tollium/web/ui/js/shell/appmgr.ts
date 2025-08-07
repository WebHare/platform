import * as $todd from "@mod-tollium/web/ui/js/support";
import * as dompack from "@webhare/dompack";
import type { ApplicationBase } from "../application";
import type { IndyShell } from "../shell";
import { TypedEventTarget, type EventMapType } from "../support/typedeventtarget";
import { debugFlags } from "@webhare/env";


//Event definities
interface AppMgrEventMap extends EventMapType {
  "activateapp": CustomEvent<{ app: ApplicationBase }>;
}


/** Manages applicaions for the shell */
export class AppMgr extends TypedEventTarget<AppMgrEventMap> {
  readonly shell;
  private uiLock: dompack.UIBusyLock | null = null;

  constructor(shell: IndyShell) {
    super();
    this.shell = shell;
  }

  /** Get currently focused application */
  getCurrent(): ApplicationBase | null {
    return $todd.applicationstack.at(-1) ?? null;
  }

  /** Activate the specified application */
  activate(app: ApplicationBase) {
    const cur = this.getCurrent();
    if (app === this.getCurrent())
      return;

    cur?.setAppcanvasVisible(false);

    //move us to the top of the applciation stack
    const apppos = $todd.applicationstack.indexOf(app);
    if (apppos >= 0)
      $todd.applicationstack.splice(apppos, 1);

    $todd.applicationstack.push(app);

    //if the previous app desired to be on the top, move it there. this keeps the dashboard from activating when closing one of multiple open apps
    if ($todd.applicationstack.length >= 3 && $todd.applicationstack[$todd.applicationstack.length - 2].onappstackbottom) {
      $todd.applicationstack.unshift($todd.applicationstack[$todd.applicationstack.length - 2]);
      $todd.applicationstack.splice($todd.applicationstack.length - 2, 1);
    }

    app.setAppcanvasVisible(true);
    this.dispatch("activateapp", { app });
  }

  onApplicationStackChange() {
    //if not app is open, open something. not sure about the best approach, we'll just try to activate the last app on the tab bar (The most recently opened one)
    if (!this.getCurrent() && this.shell.applicationbar) {
      const lasttab = this.shell.applicationbar.apps.at(-1);
      if (lasttab?.app)
        this.activate(lasttab.app);
    }

    this.notifyApplicationLockChange();
  }

  notifyApplicationLockChange() {
    const wasUILocked: boolean = Boolean(this.uiLock);
    const shouldUILock: boolean = this.getCurrent()?.isLocked() || false;
    if (debugFlags["tollium-active"])
      console.log("notifyApplicationLockChange", this.getCurrent(), "isLocked=", this.getCurrent()?.isLocked(), "shouldUILock=", shouldUILock, "wasUILocked=", wasUILocked);

    if (wasUILocked === shouldUILock)
      return;

    if (shouldUILock) {
      this.uiLock = dompack.flagUIBusy();
    } else {
      this.uiLock!.release();
      this.uiLock = null;
    }
  }

  listApps() {
    //TODO move to debug interface
    return $todd.applications.map(app => ({
      localId: app.localId,
      title: app.title,
      app,
      stackpos: $todd.applicationstack.indexOf(app),
      locked: app.isLocked()
    }));
  }
}
