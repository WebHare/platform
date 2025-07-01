import * as dompack from 'dompack';
import "./docpanel.scss";
import { getTid } from "@webhare/gettid";
import type { ApplicationBase } from '../application';

export default class DocPanel {
  edittoken: string | undefined;

  constructor(public app: ApplicationBase) {
    this.app = app;
  }
  load(url: unknown, edittoken: string) {
    this.edittoken = edittoken;

    const docpanel = this.app.appnodes.docpanel;
    docpanel.replaceChildren();
    docpanel.append(<div class={{
      "docpanel": true,
      "docpanel--canedit": edittoken !== ""
    }}>
      <div class="docpanel__buttonarea">
        <div class="docpanel__edit" title={getTid("~edit")} onClick={() => this.edit()}></div>
        <div class="docpanel__close" title={getTid("~close")} onClick={() => this.close()}></div>
      </div>
      <iframe class="docpanel__content" src={url}></iframe>
    </div>);

    //TODO only when we resize or appear, not every load..
    dompack.dispatchCustomEvent(this.app.appnodes.root, "tollium:appcanvas-resize", { bubbles: true, cancelable: false });
  }

  edit() {
    if (!this.edittoken) //race?
      return;

    this.app.shell.sendApplicationMessage("tollium:editdocumentation", { edittoken: this.edittoken }, null, "always");
  }

  close() {
    dompack.empty(this.app.appnodes.docpanel);
    dompack.dispatchCustomEvent(this.app.appnodes.root, "tollium:appcanvas-resize", { bubbles: true, cancelable: false });
  }
}
