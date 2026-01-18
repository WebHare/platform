import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as scrollmonitor from '@mod-tollium/js/internal/scrollmonitor';
import Keyboard from 'dompack/extra/keyboard';

import "./codeedit.scss";
import type { ComponentBaseUpdate, ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

// ---------------------------------------------------------------------------
//
// Codeedit
//

interface Marker {
  line: number;
  type: string; //TODO what are the valid types?
  color: string;
}

type Action = {
  action: "gotoline";
  linenum: number;
} | {
  action: "gototopline";
  linenum: number;
};

interface CodeEditAttributes extends ComponentStandardAttributes {
  "readonly": boolean;
  "required": boolean;
  "value": string;
  "hint": string;
  "actions": Action[];
  markers: Marker[];
}

type CodeEditUpdate = {
  type: "value";
  value: string;
} | {
  type: "enabled";
  value: boolean;
} | {
  type: "required";
  value: boolean;
} | {
  type: "actions";
  value: Action[];
} | {
  type: "markers";
  value: Marker[];
} | ComponentBaseUpdate;

export default class ObjCodeEdit extends ComponentBase {
  componenttype = "codeedit";

  linenumberdiv: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  isactive = false;
  markerholderdiv: HTMLDivElement;
  markerscrolldiv: HTMLDivElement;

  donelinenumbers = 0;
  pendinggotoline = 0;
  pendinggotoline_attop = false;
  synctimer: NodeJS.Timeout | null = null;

  markers: Marker[] = [];

  linenumberswidth = 36;
  node: HTMLElement;
  linenumberbg: HTMLElement;

  constructor(parentcomp: ToddCompBase, data: CodeEditAttributes) {
    super(parentcomp, data);

    this.node =
      <t-codeedit data-name={this.name} style={{ position: "relative" }}>
        {this.linenumberbg = <div className="gutter-background" />}
        {this.markerholderdiv =
          <div className="marker-container">
            {this.markerscrolldiv = <div className="marker-scroller" />}
          </div>
        }
        {this.linenumberdiv = <div className="gutter-content"
          unselectable="on"
          on={{ click: (event: MouseEvent) => this.gotGutterClick(event) }}
        />
        }
        {this.textarea = <textarea wrap="off"
          spellcheck="false"
          style={{ marginLeft: this.linenumberswidth + 2 }}
          on={{
            scroll: () => this.gotScrollEvent(),
            input: () => this.gotInput()
          }}
        />
        }
      </t-codeedit>;

    new Keyboard(this.textarea, {}, { dontpropagate: ['Enter'] });

    this.textarea.value = data.value;
    this.markers = data.markers;

    this.syncLineNumbers();
    this.syncScroll(false);

    this.syncMarkers();

    this.setEnabled(data.enabled ?? true);
    this.executeActions(data.actions);

    setTimeout(() => this.syncMarkers(), 1);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  syncLineNumbers() {
    // ADDME: calculating number of lines basedon scrollheight/lineheight might be faster?
    const needed_linenumbers = this.textarea.value.split('\n').length + 200;

    //console.log("need: "+needed_linenumbers+" have: "+this.donelinenumbers);

    if (this.donelinenumbers >= needed_linenumbers)
      return;

    //console.log("creating extra numbers, need: "+needed_linenumbers+" have: "+this.donelinenumbers);

    let extranumbers = '';
    while (this.donelinenumbers < needed_linenumbers)
      extranumbers += ++this.donelinenumbers + '\n';

    this.linenumberdiv.append(extranumbers);
    this.markerscrolldiv.style.height = this.linenumberdiv.scrollHeight + 'px';
  }

  syncMarkers() {
    const linenumberdivheight = this.linenumberdiv.scrollHeight;
    const lineheight = linenumberdivheight / this.donelinenumbers;

    dompack.empty(this.markerscrolldiv);
    this.markerscrolldiv.style.height = this.linenumberdiv.scrollHeight + 'px';
    this.markerholderdiv.scrollTop = this.linenumberdiv.scrollTop;

    this.markers.forEach(item => {
      const is_gutter_marker = item.type.substr(0, 6) === "gutter";

      this.markerscrolldiv.appendChild(
        <div className={"marker " + item.type}
          style={{
            marginLeft: is_gutter_marker ? 0 : this.linenumberswidth + 'px',
            width: is_gutter_marker ? this.linenumberswidth + 'px' : "100%",
            top: lineheight * (item.line - 1) + "px",
            height: lineheight + "px",
            background: item.color
          }} />);
    });
  }

  setSelection(startpos: number, limitpos: number) {
    this.textarea.selectionStart = startpos;
    this.textarea.selectionEnd = limitpos;
  }

  gotoLine(line: number, attop: boolean) {
    if (!this.isactive) {
      this.pendinggotoline = line;
      this.pendinggotoline_attop = attop;
      return;
    }

    this.syncLineNumbers();
    const selectpos = line === 0 ? 0 : this.textarea.value.split('\n').slice(0, line).join('\n').length + 1;
    try {
      this.setSelection(selectpos, selectpos);
    } catch (ex) {
      console.error("Caught exception while setting selection.", ex);
    }

    const lineheight = this.linenumberdiv.scrollHeight / this.donelinenumbers;
    let scrolltop = this.textarea.scrollTop;
    if (attop) {
      // Topline: honor exactly
      scrolltop = Math.max(0, line) * lineheight;
    } else {
      // When scrolling to first 3 or last 3 lines in view, scroll as little as possible
      // to get 3 lines of context
      // else center the view on the line
      const minfull_scroll = Math.max(0, (line + 1) * lineheight - this.textarea.offsetHeight);
      const maxfull_scroll = Math.max(0, line * lineheight);

      let min_scroll = Math.max(0, (line + 4) * lineheight - this.textarea.offsetHeight);
      let max_scroll = Math.max(0, (line - 3) * lineheight);

      // No 3 lines of context? Meh, always center
      if (max_scroll < min_scroll)
        max_scroll = min_scroll = line * lineheight - (this.textarea.offsetHeight - lineheight) / 2;

      if (scrolltop < minfull_scroll || scrolltop > maxfull_scroll)
        scrolltop = (min_scroll + max_scroll) / 2;
      else if (scrolltop < min_scroll)
        scrolltop = min_scroll;
      else if (scrolltop > max_scroll)
        scrolltop = max_scroll;
    }
    scrollmonitor.setScrollPosition(this.textarea, 0, scrolltop);
  }

  gotInput() {
    this.setDirty();
  }

  gotScrollEvent() {
    this.syncScroll(false);
  }

  syncScroll(immediate: boolean) {
    const scrollTop = this.textarea.scrollTop;
    //console.log("Scrollpos in scroll event: "+scrollTop);

    this.linenumberdiv.scrollTop = scrollTop;
    this.markerholderdiv.scrollTop = scrollTop;

    if (immediate)
      this.syncLineNumbers();
    else if (!this.synctimer)
      this.synctimer = setTimeout(() => this.delayedSyncLineNumbers(), 250);
  }

  delayedSyncLineNumbers() {
    this.synctimer = null;
    this.syncLineNumbers();
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled)
      return;

    this.textarea.readOnly = !enabled;
    this.enabled = enabled;
  }

  gotGutterClick(event: MouseEvent) {
    // Get click y relative to target node
    let y = event.clientY;
    let element: HTMLElement | null = event.target as HTMLElement;
    let nextoffsetparent: HTMLElement | null = element;
    while (nextoffsetparent) {
      if (element === nextoffsetparent) {
        y += element.scrollTop - element.offsetTop;
        nextoffsetparent = element.offsetParent as HTMLElement | null;
      } else
        y += element!.scrollTop;
      element = element!.parentNode as HTMLElement | null;
    }

    const lineheight = this.linenumberdiv.scrollHeight / this.donelinenumbers;
    this.queueMessage('gutterclick', { line: Math.floor(y / lineheight) + 1 }, true);
    event.preventDefault();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  executeActions(actions: Action[]) {
    for (let i = 0; i < actions.length; ++i) {
      switch (actions[i].action) {
        case 'gotoline':
          {
            const line = actions[i].linenum - 1;
            this.gotoLine(line, false);
          } break;
        case 'gototopline':
          {
            const line = actions[i].linenum - 1;
            this.gotoLine(line, true);
          } break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Layouting
  //

  calculateDimWidth() {
    this.width.min = 200;
  }

  calculateDimHeight() {
    this.height.min = 200;
  }

  relayout() {
    dompack.setStyles(this.node,
      {
        "width": this.width.set,
        "height": this.height.set
      });

    dompack.setStyles(this.textarea,
      {
        width: (this.width.set - this.linenumberswidth - 2) + 'px',
        height: this.height.set + 'px'
      });

    if (!this.isactive) { //we'll save up the first gotoline until we get into view
      this.isactive = true;
      this.gotoLine(this.pendinggotoline, this.pendinggotoline_attop);
    }

    dompack.setStyles(this.linenumberbg,
      {
        width: this.linenumberswidth + 'px',
        height: this.height.set + 'px'
      });

    dompack.setStyles(this.linenumberdiv,
      {
        width: this.linenumberswidth + 'px',
        height: this.height.set + 'px'
      });

    this.syncScroll(true);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & updates
  //

  applyUpdate(data: CodeEditUpdate) {
    switch (data.type) {
      case 'value':
        this.textarea.value = data.value;
        this.syncScroll(true);
        return;
      case 'enabled':
        this.setEnabled(data.value);
        return;
      case 'actions':
        this.executeActions(data.value);
        return;
      case 'markers':
        this.markers = data.value;
        this.syncMarkers();
        return;
      case 'required':
        //TODO implement this. but we currently have no visual indication of requiredness for codeedits (similar to RTEs)
        return;
    }

    super.applyUpdate(data);
  }

  // codeedit is always submitted for line, col, selection and topline updates
  shouldSubmitValue() {
    return true;
  }

  getSubmitValue() {
    const lineheight = this.linenumberdiv.scrollHeight / this.donelinenumbers;

    const beforeselectionlines = this.textarea.value.substr(0, this.textarea.selectionStart).split('\n');

    return {
      enabled: this.enabled,
      line: beforeselectionlines.length,
      col: beforeselectionlines[beforeselectionlines.length - 1].length + 1,
      selection: this.textarea.value.substr(this.textarea.selectionStart, this.textarea.selectionEnd - this.textarea.selectionStart),
      topline: lineheight ? Math.floor(this.textarea.scrollTop / lineheight + 1) : 1,
      value: this.enabled ? this.textarea.value : ""
    };
  }
}
