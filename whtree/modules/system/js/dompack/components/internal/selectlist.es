import * as dompack from "../../src/index.es";

export default class SelectList
{
  constructor(options)
  {
    this._class = (options ? options.baseclass : '') || 'selectlist';
    this._fixitemswidth = !(options && !options.fixitemswidth);
  }

  ///Scrolls an option into view, override to control scrolling behaviour
  scrollOptionIntoView(selection)
  {
    dompack.scrollIntoView(selection);
  }
  _generateItems(options)
  {
    if(this._items)
      dompack.empty(this._items);
    else
     this._items = dompack.create('div', { className: this._class + '__items'
                                         , on: { mouseup:   evt => this._clickItem(evt) //on 'up' we consider the selection good
                                               , mousedown: evt => this._preventFocusLoss(evt)
                                               , click:     evt => this._clickItem(evt) //catches synthetic clicks (.click on element)
                                               }
                                         });
    this._generateItemNodes(options);
  }

  _preventFocusLoss(evt) //prevent focus interference (and also mouse clicks)
  {
    evt.preventDefault();

    if(evt.target == this._items && !!window.MSInputMethodContext && !!document.documentMode) //quick & dirty IE11 check
    {
      //IE11 has an issue that clicking the scrollbar resets the focus even after cancelling, so fix that by simply blocking blur for a while
      var blurblocker = evt => dompack.stop(evt);
      window.addEventListener("blur", blurblocker, true);
      setTimeout(() => window.removeEventListener("blur", blurblocker, true), 1);
    }
  }

  _clickItem(evt)
  {
    dompack.stop(evt);

    let selectitem = evt.target.closest('.' + this._class + '__item');
    if(selectitem && this._doSelectItem(selectitem))
      this.closeSelectList();
  }

  _isOpen()
  {
    return this._anchornode.classList.contains(this._class + '--open');
  }

  _openSelectList()
  {
    if(this._isOpen())
      return;

    //fix the width, as we're removing our contents so they won't keep us at the proper width
    let pulldowncoords = this._anchornode.getBoundingClientRect();
    let itemscoords = this._items.getBoundingClientRect();

    this._openbottom = true;
    let bottomroom = window.innerHeight - pulldowncoords.bottom;
    let toproom = pulldowncoords.top;

    if(itemscoords.bottom > window.innerHeight) //the pulldown won't fit below us
    {
      //if we have at least half the room on the bottom as we do on top, still prefer bottom
      this._openbottom = bottomroom >= toproom / 2; //TODO configurable policy?
    }

    //if we Math.ceil the width, we risk triggering a word wrapping on ourselves
    this._anchornode.style.minWidth = pulldowncoords.width + 'px';
    this._items.style.minWidth = pulldowncoords.width + 'px';
    if(this._fixitemswidth)
      this._items.style.width = this._items.style.minWidth;
    this._anchornode.classList.add(this._class + '--open');
    this._items.classList.add(this._class + '__items--open');

    if(this._openbottom)
    {
      this._items.style.maxHeight = bottomroom + 'px';
    }
    else
    {
      this._items.style.maxHeight = toproom + 'px';
    }

    //set up capturing handlers to kill our pulldowns asap when something else is clicked
    if(!this._boundGlobalMouseDown)
      this._boundGlobalMouseDown = evt => this._globalMouseDown(evt);

    window.addEventListener("mousedown",  this._boundGlobalMouseDown, true);
    window.addEventListener("touchstart", this._boundGlobalMouseDown, true);

    //we need to join the body, because even with fixed ignoring overflows, we can still be clipped by z-index
    document.body.appendChild(this._items);
    //make sure te selectionis in sight!
    let selection = this._items.querySelector(`.${this._class}__item--selected`);
    if(selection)
      this.scrollOptionIntoView(selection);

    this._lastpulldowncoords = {};
    this._positionSelectList();

    this._items.style.left = Math.ceil(pulldowncoords.left) + 'px';
  }
  _positionSelectList()
  {
     if(!this._isOpen())
       return;
    //we need to copy it, getBCR is a weird object
    let bcr = this._anchornode.getBoundingClientRect();
    if(this._lastpulldowncoords.top != bcr.top
       || this._lastpulldowncoords.left != bcr.left
       || this._lastpulldowncoords.bottom != bcr.bottom)
    { //we moved
      this._lastpulldowncoords = bcr;
      if(this._openbottom)
      {
        //this._items.style.top = Math.ceil(pulldowncoords.bottom) + 'px';
        this._items.style.top = Math.floor(bcr.bottom) + 'px';
        this._items.style.bottom = '';
      }
      else
      {
        this._items.style.top = '';
        this._items.style.bottom = Math.floor(window.innerHeight - bcr.top) + 'px';
      }
    }
    requestAnimationFrame(() => this._positionSelectList());
  }
  _globalMouseDown(evt)
  {
    if(!dompack.contains(this._anchornode,evt.target) && !dompack.contains(this._items,evt.target))
      this.closeSelectList();
  }
  closeSelectList()
  {
    if(!this._isOpen())
      return;

    window.removeEventListener("mousedown",  this._boundGlobalMouseDown, true);
    window.removeEventListener("touchstart", this._boundGlobalMouseDown, true);

    if(!dompack.debugflags.meo)
    {
      //remove fixed width
      this._anchornode.style.minWidth="";
      this._items.style.minWidth="";
      if(this._fixitemswidth)
        this._items.style.width="";

      this._anchornode.classList.remove(this._class + '--open');
      this._items.classList.remove(this._class + '__items--open');
    }
  }
}
