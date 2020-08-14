/* globals $shell */

import * as dompack from 'dompack';
import "./docpanel.scss";

export default class DocPanel
{
  constructor(app)
  {
    this.app=app;
  }
  load(url, edittoken)
  {
    this.edittoken = edittoken;

    let docpanel = this.app.appnodes.docpanel;
    dompack.empty(docpanel);
    docpanel.append(<div class={{ "docpanel": true
                                , "docpanel--canedit": edittoken != ""
                               }}>
                      <div class="docpanel__buttonarea">
                        <div class="docpanel__edit" onClick={() => this.edit()}>Edit</div>
                        <div class="docpanel__close" onClick={() => this.close()}>Close</div>
                      </div>
                      <iframe class="docpanel__content" src={url}></iframe>
                    </div>);
  }

  edit()
  {
    if(!this.edittoken) //race?
      return;

   $shell.sendApplicationMessage("tollium:editdocumentation", { edittoken: this.edittoken }, null, true);
  }

  close()
  {
    dompack.empty(this.app.appnodes.docpanel);
  }
}
