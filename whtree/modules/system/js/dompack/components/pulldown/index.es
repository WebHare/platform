import * as dompack from "../../src/index.es";
import SelectList from "../internal/selectlist.es";
import KeyboardHandler from "../../extra/keyboard.es";

let watchingreset = false;

function onReset()
{
  let lock = dompack.flagUIBusy();
  //reset doesn't invoke onchange, so we'll have to recheck every select after a form reset (but we'll need to wait for the default event processing to kick in after a timeout)
  setTimeout(function()
  {
    dompack.qSA('select').forEach(node =>
    {
      if(node._dompackValueUpdated)
        node._dompackValueUpdated();
    });
    lock.release();
  });
}

function setupMyValueProperty(select)
{
  Object.defineProperty(select, 'value', { configurable:true, get: mySelectGetValue, set: mySelectSetValue });
}
function setupMySelectedIndexProperty(select)
{
  Object.defineProperty(select, 'selectedIndex', { configurable:true, get: mySelectGetSelectedIndex, set: mySelectSetSelectedIndex });
}
function mySelectGetValue()
{
  //we're not using the original getter as that appears to be broken on IE (always returns empty string)
  let selectedoption = this.options[this.selectedIndex];
  return selectedoption ? selectedoption.value : '';
}
function mySelectSetValue(newvalue)
{
  this._flushObservations();

  let origsetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').set;
  if(origsetter) //this works on chrome, firefox and IE
  {
    origsetter.apply(this,[newvalue]);
  }
  else
  {
    //safari doesnt let us call the original setter. but we _can_ remove the value property and it will be restored
    delete this.value;
    this.value = newvalue;
    setupMyValueProperty(this); //reset our custom property
  }
  this._dompackValueUpdated();
}
function mySelectGetSelectedIndex()
{
  let origgetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'selectedIndex').get;
  if(origgetter)
    return origgetter.apply(this,[]);

  //safari doesnt let us call the original setter. but we _can_ remove the value property and it will be restored
  delete this.selectedIndex;
  let retval = this.selectedIndex;
  setupMySelectedIndexProperty(this); //reset our custom property
  return retval;
}
function mySelectSetSelectedIndex(newvalue)
{
  let origsetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'selectedIndex').set;
  if(origsetter)
  {
    origsetter.apply(this,[newvalue]);
  }
  else
  {
    //safari doesnt let us call the original setter. but we _can_ remove the value property and it will be restored
    delete this.selectedIndex;
    this.selectedIndex = newvalue;
    setupMySelectedIndexProperty(this); //reset our custom property
  }
  this._dompackValueUpdated();
}


export default class Pulldown extends SelectList
{
  /** options.fixitemswidth Make the items container as wide as the pulldown. Defaults to true */
  constructor(node, options, old_options)
  {
    if(typeof options == 'string')
      options = {...old_options, baseclass: options };

    super(options);
    if(!window.MutationObserver)
      return; //we cannot safely take over without a MutationObserver, so let's just abort and hope the native control stays in place due to not setting --replaced

    if(!watchingreset)
    {
      document.addEventListener('reset', onReset, true);
      watchingreset = true;
    }

    this._replacednode = node;
    this._replacednode.classList.add(this._class + "--replaced");
    this._replacednode.addEventListener('change', evt =>
      {
        if(evt.detail && evt.detail.__norefresh)
          return;
        this.refresh();
      });
    this._replacednode.addEventListener('dompack:takefocus', evt => this._takeFocus(evt));

    //replacements that allow us to track value & selectedIndex
    setupMyValueProperty(this._replacednode);
    setupMySelectedIndexProperty(this._replacednode);

    this._replacednode._flushObservations = () => this.refresh({generateitems:true});
    this._replacednode._dompackValueUpdated = () => this.refresh();

    /* creating this structure:

       <div class=xxx
         <div class=xxx__area
           <div class=xxx__control
             <div class=xxx__current
             <div class=xxx__arrow
           <div class=xxx__items
             <div class=xxx_item
             <div class=xxx_item
             <div class=xxx_item
    */

    this._arrow = dompack.create('div', { className: this._class + '__arrow'
                                        });
    this._control = dompack.create('div', { className: this._class + '__control'
                                          , childNodes: [ this._arrow ]
                                          });
    this._area = dompack.create('div', { className: this._class + '__area'
                                       , childNodes: [ this._control, this._items ]
                                       });
    this._anchornode = dompack.create('div', { className: this._class
                                             , childNodes: [this._area]
                                             , on: { mousedown: evt => this._controlMouseDown(evt)
                                                   , blur: evt => this._onBlur(evt)
                                                   }
                                             , tabIndex: 0
                                             });

    dompack.after(this._replacednode, this._anchornode);

    this.refresh({ insertitems: true, generateitems: true });

    this._observer = new MutationObserver(mutations => this._onObserve(mutations));
    this._observer.observe(this._replacednode, { attributes: true, attributeFilter:['disabled','class'], subtree: true, childList:true});

    new KeyboardHandler(this._anchornode, { "ArrowUp": evt => this._onArrow(evt, -1)
                                          , "ArrowDown": evt => this._onArrow(evt, +1)
                                          , "Enter": evt => this._onEnter()
                                          , " ": evt => this._onSpace(evt)
                                          , "Escape": evt => this._onEscape()
                                          }, { "onkeypress": (event,key) => this._onKey(event,key) });
  }

  refresh(options)
  {
    this._refreshNewnodeClasses();

    if(options && options.generateitems)
      this._generateItems();
    else
      this._updateItems();

    if(options && options.insertitems)
      this._area.appendChild(this._items);
    this._updateDisplayValue();

    if(!this._isOpen())
      dompack.registerMissed(this._area);
  }

  /////////////////////////////
  //
  // Keyboard support
  //
  _onArrow(evt, direction)
  {
    dompack.stop(evt);
    if(!this._isOpen())
    {
      this._openSelectList();
      return;
    }

    this._loopToItem(direction, null);
  }
  _activateCurrentItem()
  {
    let selectitem = this._items.querySelector(`.${this._class}__item--selected`);
    if(selectitem && this._doSelectItem(selectitem))
      this.closeSelectList();
  }

  _onEnter()
  {
    if(this._isOpen())
      this._activateCurrentItem();
  }
  _onEscape()
  {
    let allitems = Array.from(this._items.querySelectorAll(`.${this._class}__item`));
    let selectidx = allitems.findIndex(node => node.classList.contains(this._class + '__item--selected'));
    if(selectidx == this._replacednode.selectedIndex) //no change
      return;
    if(selectidx >= 0)
      allitems[selectidx].classList.remove(this._class + '__item--selected');
    if(this._replacednode.selectedIndex >= 0)
      allitems[this._replacednode.selectedIndex].classList.add(this._class + '__item--selected');

    this.closeSelectList();
  }
  _onSpace(evt)
  {
    dompack.stop(evt);
    if(this._isOpen())
      this._activateCurrentItem();
    else
      this._openSelectList();
  }
  _loopToItem(direction, filter)
  {
    let allitems = Array.from(this._items.querySelectorAll(`.${this._class}__item`));
    let current = allitems.findIndex(node => node.classList.contains(this._class + '__item--selected'));
    if(current < 0)
      current = 0;

    let selectidx = current;
    //maxiterations protects against corner cases such as all items being disabled, or the filter function modifying the list.
    for(let maxiterations = allitems.length;maxiterations>0;--maxiterations)
    {
      //go to next item, looping to first if needed
      selectidx += direction;
      if(selectidx == allitems.length)
        selectidx = 0;
      else if(selectidx < 0)
        selectidx = allitems.length - 1;

      if(selectidx == current) //back where we started?
        return; //then no match

      if(allitems[selectidx].classList.contains(this._class + '__item--disabled'))
        continue; //disabled items never match

      if(!filter || filter(allitems[selectidx])) //match!
      {
        if(this._isOpen())
        {
          allitems[current].classList.remove(this._class + '__item--selected');
          allitems[selectidx].classList.add(this._class + '__item--selected');
          this.scrollOptionIntoView(allitems[selectidx]);
        }
        else
        {
          this._doSelectItem(allitems[selectidx]); //this will trigger change immediately
        }
        return;
      }
    }
  }
  _onKey(event,key)
  {
    if(key.length != 1 || key == ' ') //special key
      return true;

    key = key.toUpperCase();
    this._loopToItem(+1, node =>
      {
        let tc = node.textContent.trim();
        return tc[0] && tc[0].toUpperCase() == key;
      });
    dompack.stop(event);
  }

  _onBlur()
  {
    if(!dompack.debugflags.meo)
      this.closeSelectList();
  }

  _takeFocus(evt)
  {
    evt.preventDefault();
    dompack.focus(this._anchornode);
  }

  _onObserve(mutations)
  {
    let anyoptionchange = mutations.some(mutation => mutation.type == 'childList'
        || (mutation.type == 'attributes'
            && (mutation.attributeName == 'class' || mutation.attributeName == 'disabled')));

    //TODO figure out what exactly changed and optimize, we can take the observer's records i think
    this.refresh({generateitems: anyoptionchange});
    //testcode uses this. end users should not rely on it
    dompack.dispatchCustomEvent(this._replacednode,'dompack:-internal-refreshed',{bubbles:false, cancelable:false});
  }

  _refreshNewnodeClasses()
  {
    dompack.toggleClass(this._anchornode, this._class + '--disabled', this._replacednode.disabled);
  }

  _generateOptions(childnodes, inoptgroup, idx)
  {
    for(let opt of childnodes)
    {
      if(!inoptgroup && opt.nodeName == 'OPTGROUP')
      {
        let node = dompack.create('div', { className: this._class + '__optgroup' + ' ' + opt.className
                                         , textContent: opt.getAttribute("label") || '\u00a0'
                                         , dataset: { ...opt.dataset
                                                    , dompackPulldownIndex: -1
                                                    }
                                         , _pulldownidx: -1
                                         });
        this._items.appendChild(node);
        idx = this._generateOptions(opt.childNodes, true, idx);
      }
      else if(opt.nodeName=='OPTION')
      {
        let node = dompack.create('div', { className: this._class + '__item' + ' '
                                                      + (inoptgroup ? this._class + '__item--ingroup ' : '')
                                                      + opt.className
                                         , textContent: opt.textContent || '\u00a0'
                                         , dataset: { ...opt.dataset
                                                    , dompackPulldownIndex: idx
                                                    }
                                         , _pulldownidx: idx
                                         });

        if(opt.disabled)
          node.classList.add(this._class + '__item--disabled');
        if(opt.selected)
          node.classList.add(this._class + '__item--selected');

        this._items.appendChild(node);
        ++idx;
      }
    }
    return idx;
  }

  _updateItems()
  {
    //Fixup selection classes
    dompack.qSA(this._items, '.' + this._class + '__item--selected').forEach(node => node.classList.remove(this._class + '__item--selected'));
    if(this._replacednode.selectedIndex >= 0)
    {
      let toselect = this._items.querySelector(`*[data-dompack-pulldown-index="${this._replacednode.selectedIndex}"]`);
      if(toselect)
        toselect.classList.add(this._class + '__item--selected');
    }

    //Reenable any incorrectly disabled nodes
    dompack.qSA(this._items, '.' + this._class + '__item--disabled').filter(node => !this._replacednode.options[node._pulldownidx].disabled).forEach(node => node.classList.remove(this._class + '__item--disabled'));
    //Disable any incorrectly enabled nodes
    Array.from(this._replacednode.options).forEach((option,idx) =>
    {
      if (option.disabled)
      {
        let todisable = this._items.querySelector(`*[data-dompack-pulldown-index="${idx}"]`);
        if(todisable)
          todisable.classList.add(this._class + '__item--disabled');
      }
    });
  }

  _generateItemNodes(options)
  {
    this._generateOptions(this._replacednode.childNodes, false, 0);
  }

  _updateDisplayValue()
  {
    let toshow = this._replacednode.options[this._replacednode.selectedIndex];
    let newcurrent = dompack.create('div', { className: this._class + '__current'
                                           , textContent: (toshow ? toshow.textContent : '') || '\u00a0'
                                           });
    if(toshow)
    { //copy value and attributes
      newcurrent.dataset.optionvalue = toshow.value;
      Object.keys(toshow.dataset).forEach(key => newcurrent.dataset["option" + key.substr(0,1).toUpperCase() + key.substr(1)] = toshow.dataset[key]);
    }

    if(this._current)
      this._control.replaceChild(newcurrent, this._current);
    else
      this._control.insertBefore(newcurrent, this._arrow);

    this._current = newcurrent;

    dompack.registerMissed(this._current);
  }

  closeSelectList()
  {
    super.closeSelectList();
    this._area.appendChild(this._items);
  }

  _controlMouseDown(evt)
  {
    if(evt.button != 0)
      return; //only care about LMB
    if(dompack.contains(this._items, evt.target))
      return;//do not interfere with clicks inside the items area

    let isopen = this._isOpen();
    if(!isopen && this._replacednode.disabled)
      return; //the original node is locked, thus so are we

    this._anchornode.focus();

    evt.preventDefault();
    evt.stopPropagation();

    if(isopen)
      this.closeSelectList();
    else
      this._openSelectList();
  }

  _doSelectItem(selectitem) //return whether we can close the optionlist
  {
    if(this._replacednode.options[selectitem._pulldownidx].disabled)
      return false; //do not close (and not a change)

    if(this._replacednode.selectedIndex == selectitem._pulldownidx)
      return true; //no change, but would have otherwise been a change, so close

    this._replacednode.selectedIndex = selectitem._pulldownidx;

    //fire the update event, but signal our change event not to refresh
    dompack.fireModifiedEvents(this._replacednode, { detail: { __norefresh : true }});
    return true; //change, close!
  }
}
