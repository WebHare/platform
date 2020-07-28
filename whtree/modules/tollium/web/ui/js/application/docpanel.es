import * as dompack from 'dompack';
import "./docpanel.scss";

export default class DocPanel
{
  constructor(app)
  {
    this.app=app;
  }
  load(url)
  {
    dompack.empty(this.app.appnodes.docpanel);
    this.app.appnodes.docpanel.appendChild(<iframe class="docpanel" src={url}/>);
  }
}
