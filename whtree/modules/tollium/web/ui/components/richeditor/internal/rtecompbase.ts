import * as dompack from '@webhare/dompack';
import { getDefaultToolbarLayout, type EditorBaseOptions } from "./editorbase";
import type { RTEToolbarOptions } from './toolbar';

export class RTECompBase {
  options: EditorBaseOptions;
  toolbarnode;
  toolbaropts: Partial<RTEToolbarOptions>;

  /** The 'style scope' node is the point from which we apply the rewritten css. it needs to be the immediate parent of the wh-rtd__html node */
  stylescopenode;

  /** Represents the <html> node in the editor */
  htmldiv;

  constructor(protected readonly container: HTMLElement, options: Partial<EditorBaseOptions>) {
    this.options = {
      allowtags: null,
      log: false,
      contentareawidth: null,
      imgloadplaceholder: null, //image loader GIF image to use (defaults to embedded spinning loader)
      structure: null,
      hidebuttons: [],
      content: '',
      enabled: true,
      readonly: false,
      //, actionhandler: null
      cssinstance: null,
      csslinks: null,
      csscode: '',
      preloadedcss: null,
      breakupnodes: [],
      htmlclass: '',
      bodyclass: '',

      contentarea: true, //display a content area if possible
      editembeddedobjects: true,
      allowundo: Boolean(options?.structure),
      margins: 'compact',
      propertiesaction: false, //add properties button to toolbar/menus (only set if you're going to intercept action-properties)
      toolbarlayout: null,
      language: 'en', //TODO get default language from document lang and/or gettidLanguage?
      ...options
    };

    this.container.replaceChildren(); //expect super() caller to backup any contents

    if (this.container.classList.contains("wh-rtd__editor"))
      throw new Error("Duplicate RTD initialization");

    this.toolbarnode = dompack.create("div", { className: "wh-rtd-toolbar" });
    this.stylescopenode = dompack.create("div", { className: "wh-rtd__stylescope " + (this.options.cssinstance || '') });

    this.container.classList.add("wh-rtd__editor");
    this.container.append(this.toolbarnode, this.stylescopenode);
    if (this.options.structure)
      this.container.classList.add("wh-rtd--structured");

    this.htmldiv = dompack.create("div", {
      className: "wh-rtd-editor wh-rtd__html wh-rtd-editor-htmlnode " + this.options.htmlclass,
    });
    this.stylescopenode.append(this.htmldiv);

    const toolbaropts = {
      hidebuttons: this.options.hidebuttons,
      allowtags: this.options.allowtags,
      layout: this.options.toolbarlayout || getDefaultToolbarLayout()
    };

    if (this.options.structure) {
      toolbaropts.hidebuttons.push('action-clearformatting');
    } else {
      toolbaropts.hidebuttons.push('p-class', 'action-showformatting', 'object-insert', 'object-video', 'table');
    }
    if (!this.options.propertiesaction)
      toolbaropts.hidebuttons.push('action-properties');

    this.toolbaropts = toolbaropts; //preserve until constructorTail. we can probably get rid of this property by further cleaning up construction
  }
}
