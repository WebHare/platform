import type { ApplicationBase } from "../application";

/** Manages applicaions for the shell */
export class AppMgr {
  /** Activate the specified application */
  activate(app: ApplicationBase) {
    app.activateApp();
  }
}
