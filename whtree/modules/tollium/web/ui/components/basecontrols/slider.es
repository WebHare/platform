require ('./slider.css');
import * as dompack from 'dompack';
import * as movable from 'dompack/browserfix/movable';

/* PLEASE NOTE:
   - all slider features which lack test coverage or a tollium handler have been
     disabled */

/*
  Public
    Functions:
      refresh
      setValues
      getValues
      getValue
    Events:
      sliderstart
      slidermove
      sliderend
      change

  css: .wh-slider-holder > .wh-slider > .wh-slider-knob
                                      > .wh-slider-rangebar (optional)

  Example html:
  <div id="sliders_holder" class="wh-slider-holder">
    <div class="wh-slider"><div class="wh-slider-rangebar"></div><div class="wh-slider-knob drag1"></div><div class="wh-slider-knob drag2"></div></div>
  </div>

*/

export default class Slider
{
 //internal params

  constructor (inputnode, selector, options)
  {
    this.value        = null; //updated during dragging
    this.values       = [];
    this.scale        = 1;
    this.size         = 0;
    this.node         = null;
    this.slidebasenode = null;
    this.rangebar     = null;
    this.isvertical   = false;
    this.keys         = null;           //keyboard object
    this.inputnode = inputnode;
    this.node = selector;
    this.options = { minvalue         : 0
                  , maxvalue         : 100
                  , startvalues      : [50]
                  , limitdragarea    : false //only keep dragging if in sliderarea (.wh-slider-holder)
                  , snap             : 0     //snap interval, 0:nosnapping
                  , enablemouseclick : false //if enabled, a mouseclick on sliderarea will position directly closest dragger
                  , ticklist         : [] //list of positions where to place ticks
                  , tickinterval     : 0  //show ticks with given inteval (if > 0)
                  , resizelistener   : false
                  , ...options
                  };

    this.slidebasenode = this.node.querySelector('.wh-slider');
    if(!this.slidebasenode)
    {
      console.log('Wrong selector, no class wh-slider found');
      return false;
    }

    this.isvertical = this.node.classList.contains('vertical') || this.slidebasenode.classList.contains('vertical');

/* ticks are a nice idea but not used by Tollium now
    var c;
    if(this.options.tickinterval > 0)
    {
      var pinterval = Math.abs(this.options.maxvalue - this.options.minvalue) / this.options.tickinterval;
      var ticks = Math.floor(pinterval);
      pinterval = (100/pinterval);
      for(c = ticks; c >=0; c--)
      {
        if(!this.options.ticklist.includes(this.options.minvalue + this.options.tickinterval*c))
        {
          var val = this.options.minvalue + c*this.options.tickinterval;
          let tick;
          if(this.isvertical)
            tick = dompack.create('div',{ className : 'wh-tick tick' + c, 'style' : 'top:' + (pinterval*c) + '%', 'data-value' : val } )
          else
            tick = dompack.create('div',{ className : 'wh-tick tick' + c, 'style' : 'left:' + (pinterval*c) + '%', 'data-value' : val } );

          this.slidebasenode.prepend(tick);
        }
      }
    }

    for(c = 0; c < this.options.ticklist.length; c++)
    {
      var pos = (this.options.ticklist[c] - this.options.minvalue)*100 / (this.options.maxvalue - this.options.minvalue);
      let tick;

      if(this.isvertical)
        dompack.create('div',{ 'class' : 'wh-tick ticklist ticklist' + c, 'style' : 'top:' + pos + '%', 'data-value' : this.options.ticklist[c] } ).inject(this.slidebasenode,'top');
      else
         dompack.create('div',{ 'class' : 'wh-tick ticklist ticklist' + c, 'style' : 'left:' + pos + '%', 'data-value' : this.options.ticklist[c] } ).inject(this.slidebasenode,'top');

    }
*/
    //slider can have multiple knobs (but not yet in tollium)
    var minvalue = null;
/*
    this.size       = this.getNodeSize(this.slidebasenode);
    this.scale      = (this.options.maxvalue - this.options.minvalue) / (this.isvertical ? this.size.y : this.size.x);
*/
    dompack.qSA(this.slidebasenode, '.wh-slider-knob').forEach( (dragnode,i) =>
    {
      dragnode.wh_dragpos = 0;

      var startvalue = 0;
      if(i < this.options.startvalues.length)
        startvalue = this.options.startvalues[i];

      if(startvalue < this.options.minvalue)
        startvalue = this.options.minvalue;

      if(startvalue > this.options.maxvalue)
        startvalue = this.options.maxvalue;

      if(this.options.snap > 0)
        startvalue = this.calcSnapValue(startvalue);

      this.values.push(startvalue);

      if(i == 0 || startvalue < minvalue)
        minvalue = startvalue;

      dragnode.wh_value = startvalue;
      dragnode.propKnobNr = i;
      dragnode.addEventListener("dompack:movestart", evt => { console.log("movestart",evt); evt.stopPropagation() });
      dragnode.addEventListener("dompack:moveend", evt => evt.stopPropagation());
      dragnode.addEventListener("dompack:move", evt => this._onMoveDragger(evt));

      movable.enable(dragnode);

    });

    this.refresh();
/* ADDME readd rangebar support but need tests? AFAIK tollium can't connect to this feature yet
    this.rangebar = this.slidebasenode.querySelector('.wh-slider-rangebar');
    if(this.rangebar)
    {
      this.rangebar.wh_value = minvalue;
      this.rangebar.wh_dragpos = Math.round(minvalue/this.scale);

/*      if(this.values.length > 1)
      {//make draggable if it's a rangebar between draggers
        var dragoptions = { events: { "dra gmove" : this.onDragMove.bind(this,this.rangebar,-1)
                                    , "dra gend"  : this.onDragEnd.bind(this,this.rangebar)
                                    , "dra gstart": this.onDragStart.bind(this,this.rangebar)
                                    }
                          };
        this.rangebar.wh_dragger = new domdragevents.DragEvents(this.rangebar,dragoptions);
      }
* /
      this.updateRangebarPosition(this.values);
    }

/* FIXME
    this.keys = new Keyboard({ defaultEventType: 'keydown'
                             , events: { 'up'   : this.up.bind(this)
                                       , 'right': this.up.bind(this)
                                       , 'down' : this.down.bind(this)
                                       , 'left' : this.down.bind(this)
                                       }
                            });
*/

    /* ADDME restore?
    this.node.addEvent('mousewheel',this.onMouseWheel.bind(this));
*/

    if(this.options.enablemouseclick)
    {
      //capture click on bar and move closest dragger to this point
      this.node.addEventListener('mousedown', event =>
      {
        event.stopPropagation();

        if(event.target.classList.contains('wh-tick'))
          this.onTickClick(event.target);//go straight for the tick value
        else
          this.jumpToPosition(this._getPosFromEvent(event));
      });
    }
  }
/*
  onTickClick(ticknode)
  {
    var val = ticknode.get('data-value');
    if(val != null)
    {
      val = Number(val);
      var valindex = -1;
      var delta = 0;
      for(var i = 0; i < this.values.length; i++) //get nearest value
      {
        var dval = Math.abs(this.values[i] - val);
        if(dval < delta || valindex == -1)
        {
          delta = dval;
          valindex = i;
        }
      }
      if(valindex > -1)
      {
        this.values[valindex] = val;
        this.setValues(this.values);
        this.fireEvent('change',ticknode);
      }
    }
  }
 ADDME restore ?
  onMouseWheel(ev)
  {
    //if(!this.keys.isActive()) //check if we have focus
      //return;

    if(ev.wheel > 0)
      this.up(ev);
    else if(ev.wheel < 0)
      this.down(ev);
  }

  down (ev)
  {
    ev.stop();

    var referencenode = null;
    this.slidebasenode.getElements('.wh-slider-knob').each(function(dragnode)
    { //get nearest dragger
      if(!referencenode || referencenode.wh_dragpos > dragnode.wh_dragpos)
        referencenode = dragnode;
    });

    if(this.options.snap > 0)
    {
      this.values[0]-=this.options.snap;
      this.setValues(this.values);
      this.fireEvent('change',referencenode);
    }
    else
    {
      this.jumpToPosition(referencenode.wh_dragpos - 1);//move one px
    }
  }

  up (ev)
  {
    ev.stop();

    var referencenode = null;
    this.slidebasenode.getElements('.wh-slider-knob').each(function(dragnode)
    { //get nearest dragger
      if(!referencenode || referencenode.wh_dragpos < dragnode.wh_dragpos)
        referencenode = dragnode;
    });

    if(this.options.snap > 0)
    {
      this.values[this.values.length-1]+=this.options.snap;

      this.setValues(this.values);
      this.fireEvent('change',referencenode);
    }
    else
    {
      this.jumpToPosition(referencenode.wh_dragpos + 1);//move one px
    }
  }
*/
  jumpToPosition(mousepos)
  {//jump to cursor position on mousedown
    var changed = false;
    var values = this.values;

    //get nearest dragger
    var nearestnode = null;
    var delta = -1;
    var minnode = null;
    var maxnode = null;
    var dragnodes = dompack.qSA(this.slidebasenode, '.wh-slider-knob');
    dragnodes.forEach(function(dragnode)
    {
      var relpos = Math.abs(dragnode.wh_dragpos - mousepos);
      if(!nearestnode || relpos < delta)
      {
        nearestnode = dragnode;
        delta = relpos;
      }

      if(!minnode || dragnode.wh_dragpos < minnode.wh_dragpos)
        minnode = dragnode;

      if(!maxnode || dragnode.wh_dragpos > maxnode.wh_dragpos)
        maxnode = dragnode;
    });
/* ADDME
    if(this.rangebar)
    {
      if(mousepos < minnode.wh_dragpos || mousepos > maxnode.wh_dragpos)
      {//only if position is outside rangebar, move rangebar to new position
        var firstpos = mousepos;
        if(firstpos > maxnode.wh_dragpos)
          firstpos-=(maxnode.wh_dragpos - minnode.wh_dragpos);
        delta = minnode.wh_dragpos - firstpos;

        dragnodes.each(function(dragnode,i)
        {
          var val = (dragnode.wh_dragpos - delta)*this.scale + this.options.minvalue;
          if(this.options.snap > 0)
            val = this.calcSnapValue(val);
          changed = changed || (val != this.values[i]);
          values[i] = val;
          if(dragnode == minnode)
            this.value = val;
        }.bind(this));
      }
    }
    else*/
    {//move nearest dragnode to new position
      dragnodes.forEach((dragnode,i) =>
      {
        if(nearestnode == dragnode)
        {
          var val = mousepos*this.scale + this.options.minvalue;
          if(this.options.snap > 0)
            val = this.calcSnapValue(val);
          changed = (val != this.values[i]);
          values[i] = val;
          this.value = val;
        }
      });
    }

    if(changed)
      this.setValues(values, false, true);
  }

  log10 (val)
  { //IE doesn't support Math.log10
    return Math.log(val) / Math.log(10);
  }

  calcSnapValue(value)
  {
    var precision = this.options.snap > 0 ? this.log10(this.options.snap) : 0;
    if(precision <= 0)
    {
      precision = Math.pow(10, precision || 0).toFixed(precision < 0 ? -precision : 0);
      value = Math.round(Number(value) * precision) / precision;
    }
    else
    {
      var f = value - Math.floor(value / this.options.snap)*this.options.snap;
      if(f > 0)
      {
        value = Math.floor(value / this.options.snap)*this.options.snap;
        if(f >= this.options.snap*0.5)
          value+=this.options.snap;
      }
      value = Math.round(value);
    }

    return value;
  }

  getNodeSize(node)
  {
    var d = node.getBoundingClientRect();
    return {x : d.width, y : d.height};
  }

  //Public: use refresh if size of slider has changed
  refresh()
  {
    this.size = this.getNodeSize(this.slidebasenode);
    this.scale = (this.options.maxvalue - this.options.minvalue) / (this.isvertical ? this.size.y : this.size.x);

    dompack.qSA(this.slidebasenode, '.wh-slider-knob').forEach((dragnode,i) =>
    {
      this.updateKnobPosition(dragnode);

      if(this.rangebar && this.values.length > 1)
        this.updateRangebarPosition(this.values);

    });

  }

  //Public:
  getValue()
  {
    return (this.options.snap > 0 ? this.calcSnapValue(this.value) : this.value);
  }

  //Public:
  getValues()
  {
    var values = this.values;

    if(this.options.snap > 0)
    {
      for(var i = 0; i < this.values.length; i++)
        values[i] = this.calcSnapValue(values[i]);
    }

    return values;
  }

  //Public: Override intial/current dragger values
  setValues(values, nosnap, events)
  {
    if(typeof values == 'object')
    {
      for(var c=0; c < values.length && c < this.values.length; c++)
        this.values[c] = values[c];
    }
    else if(this.values.length)
    {
      this.values[0] = values;
    }

    for(var i=0; i < this.values.length; i++)
    {
      if(this.values[i] < this.options.minvalue)
        this.values[i] = this.options.minvalue;
      else if(this.values[i] > this.options.maxvalue)
        this.values[i] = this.options.maxvalue;
    }

    var rangebarvalues = this.values;
    dompack.qSA(this.slidebasenode, '.wh-slider-knob').forEach(function(dragnode,i)
    {
      var snapvalue = this.values[i];
      if(this.options.snap > 0)
      {
        snapvalue = this.calcSnapValue(this.values[i]);
        rangebarvalues[i] = !nosnap ? snapvalue : this.values[i];
      }

      dragnode.wh_value   = snapvalue;
      this.updateKnobPosition(dragnode);
    }.bind(this));

    if(this.rangebar)
      this.updateRangebarPosition(this.values);

    this._onChanged(events);
  }

  _onMoveDragger(event)
  {
    event.stopPropagation();

    let dragnode = event.detail.listener;
    let pos = this.calcDragInfo2(event.detail, dragnode);
    let changed = false;

    if(this.value!=null)
      changed = pos.snapvalue != this.value;

    this.value = this.options.snap > 0 ? pos.snapvalue : pos.value;
    dragnode.wh_value = this.value;
    this.updateKnobPosition(dragnode);
    this.values[dragnode.propKnobNr] = this.value;

    if(this.rangebar)
      this.updateRangebarPosition();

    if(changed)
      this._onChanged(true);

    //this.fireEvent('slidermove',dragnode);
  //Internal
  }/*
  onDragMove(dragnode,knobnr,event)
  {
    if(this.options.limitdragarea)
    {
      var parentnode = event.target.closest('.wh-slider-holder');
      if(parentnode != this.node && event.target != this.node)
      {
        dragnode.wh_dragger.fireEvent("dragcancel", event);
        dragnode.wh_dragger.dragging = null;
        event.stop();
        return false;
      }
    }

    var changed = false;
    var pos;
    if(knobnr < 0)
    {//dragging rangebar
      var minvalue = this.values[0];
      var maxvalue = this.values[0];
      var i;
      for(i=0;i < this.values.length; i++)
      {//determin min.max value
        if(this.values[i] < minvalue)
          minvalue = this.values[i];
        else if(this.values[i] > maxvalue)
          maxvalue = this.values[i];
      }

      pos = this.calcDragInfo(event.page,dragnode);
      dragnode.wh_dragpos = pos.px;

      this.value = pos.snapvalue;

      // knob with minvalue corresponds with position rangebar
      var delta = this.value - minvalue;
      if(delta + minvalue < this.options.minvalue)
        delta = this.options.minvalue - minvalue;
      else if(delta + maxvalue > this.options.maxvalue)
        delta = this.options.maxvalue - maxvalue;

      var newvalues = [];
      var oldvalues = this.getValues();
      for(i=0;i < this.values.length; i++)
      {
        var val = this.calcSnapValue(this.values[i] + delta);
        newvalues.push(val);
        if(!changed)
          changed = !oldvalues.contains(val);
      }

      this.setValues(newvalues,true);//update knob and rangebar positions
    }
    else
    {//dragging a knob
      pos = this.calcDragInfo(event.page,dragnode);

      if(this.value!=null)
        changed = pos.snapvalue != this.value;

      this.updateKnobPosition(pos,dragnode);
      this.value = this.options.snap > 0 ? pos.snapvalue : pos.value;
      dragnode.wh_value = this.value;
      this.values[knobnr] = this.value;

      if(this.rangebar)
        this.updateRangebarPosition();
    }

    if(changed)
      this.fireEvent('change',dragnode);

    this.fireEvent('slidermove',dragnode);
  }*/
  _onChanged(events)
  {
    var values = this.getValues();

    for(var c = 0; c < this.knobs.length; c++)
      this.knobs[c].querySelector('span.value').textContent = this.knobs[c].wh_value;

    this.inputnode.value = values.join(',');
    if(events)
    {
      //FIXME we should fire 'input' on any change but 'change' only on blur
      dompack.dispatchDomEvent(this.inputnode, 'input');
      dompack.dispatchDomEvent(this.inputnode, 'change');
    }
  }

  _getPosFromEvent(event)
  {
    let baserect = this.slidebasenode.getBoundingClientRect();
    let pixelpos;
    if(this.isvertical)
      pixelpos = Math.max(0, Math.min(baserect.height, event.clientY - baserect.top));
    else
      pixelpos = Math.max(0, Math.min(baserect.width, event.clientX - baserect.left));
    return pixelpos;
  }

  calcDragInfo2(eventdetail,dragnode)
  {
    var dragvalues = {px:dragnode.wh_dragpos,value:null,snapvalue:null};

    dragvalues.px = this._getPosFromEvent(eventdetail);

    dragvalues.value = dragvalues.px * this.scale + this.options.minvalue;

    if(dragvalues.value < this.options.minvalue)
      dragvalues.value = this.options.minvalue;
    else if(dragvalues.value > this.options.maxvalue)
      dragvalues.value = this.options.maxvalue;

    if(this.options.snap > 0)
      dragvalues.snapvalue = this.calcSnapValue(dragvalues.value);
    else
      dragvalues.snapvalue = dragvalues.value;

    return dragvalues;
  }
  //Internal
  updateKnobPosition(dragnode)
  {
    dragnode.wh_dragpos = Math.round((dragnode.wh_value - this.options.minvalue)/this.scale);

    if(this.isvertical)
      dragnode.style.top = dragnode.wh_dragpos + 'px';
    else
      dragnode.style.left = dragnode.wh_dragpos + 'px';
  }
  //Internal
  updateRangebarPosition()
  {
    var rangemin = this.values.length > 1 ? this.values[0] : this.options.minvalue;
    var rangemax = this.values[0];

    for(var i=1; i < this.values.length; i++)
    {
      if(this.values[i] < rangemin)
        rangemin = this.values[i];
      else if(this.values[i] > rangemax)
        rangemax = this.values[i];
    }

    var rangepos  = Math.floor((rangemin - this.options.minvalue)/this.scale);
    var rangesize = Math.floor((rangemax - rangemin)/this.scale);

    this.rangebar.wh_value   = rangemin;
    this.rangebar.wh_dragpos = rangepos;

    if(this.isvertical)
      dompack.setStyles(this.rangebar, {'top': rangepos +'px', 'height': rangesize +'px'});
    else
      dompack.setStyles(this.rangebar, {'left': rangepos +'px', 'width': rangesize +'px'});

  }
}

export function replaceRangeComponent(inputnode, options)
{
  options = {...options};
  if (!("enablemouseclick" in options))
    options.enablemouseclick = true;
  if (!("minvalue" in options))
    options.minvalue = 1*inputnode.getAttribute('min');
  if (!("maxvalue" in options))
    options.maxvalue = 1*inputnode.getAttribute('max');
  var c, values;
  if (!("startvalues" in options))
  {
    options.startvalues = [];
    if(inputnode.getAttribute('data-values'))
    {
      values = inputnode.getAttribute('data-values').replace(/[^0-9\.]+/g,',').split(',');//only allow numbers separated by comma
      for(c = 0; c < values.length; c++)
      {
        if(values[c] != '')
          options.startvalues.push(1*values[c]);
      }
    }
    else
    {
      options.startvalues = [parseInt(inputnode.getAttribute('value')) || 1];
    }
  }
  if (!("snap" in options))
    options.snap = parseInt(inputnode.getAttribute('step')) || 1;
  /*if (!("tickinterval" in options))
    options.tickinterval = 1*inputnode.get('data-tickinterval');
  */
  /*
  if (!("ticklist" in options))
  {
    options.ticklist = [];
    if(inputnode.dataset.ticks != null)
    {
      var tickliststr = inputnode.get('data-ticks').replace(/,/g,' ');
      tickliststr = tickliststr.replace(/\s+/g,' ');
      var ticklist = tickliststr.split(' ');
      for(c=0; c < ticklist.length; c++)
      {
        var t = 1*ticklist[c];
        if(!options.ticklist.contains(t) && t >= options.minvalue && t <= options.maxvalue)
          options.ticklist.push(t);
      }
    }
  }
*/
  var orientation = inputnode.getAttribute('orient');
  var isvertical = (orientation && orientation.toUpperCase() == 'VERTICAL');

  var tabindex = inputnode.tabIndex;
  if(!tabindex)
    tabindex = '0';

  var inputclasses = inputnode.className;
  if(!inputclasses)
    inputclasses = '';

  //if((options.tickinterval > 0 || options.ticklist.length) && !inputnode.classList.contains('interval'))
//    inputclasses+= ' interval';//slider with interval has other layout then without

  if(isvertical && !inputnode.classList.contains('vertical'))
    inputclasses+= ' vertical';

  var replacenode = dompack.create('div', { className : 'wh-slider-holder ' + inputclasses, 'tabIndex' : tabindex });

  replacenode.appendChild(dompack.create('div', { className : 'whslider__minvalue', 'text' : options.minvalue }));
  var slidernode = dompack.create('div', { className : 'wh-slider' });
  replacenode.appendChild(slidernode);
  replacenode.appendChild(dompack.create('div', { className : 'whslider__maxvalue', 'text' : options.maxvalue }));


  var knobs = [];
  knobs.push(dompack.create('div', { className : 'wh-slider-knob'}));
  var valuewrappernode = dompack.create('div', { className : 'value-wrapper'});
  knobs[0].append(valuewrappernode);
  valuewrappernode.append(dompack.create('span', { className : 'value'}));

  for(c = 1; c < options.startvalues.length; c++)
  {
    knobs.push(dompack.create('div', { className : 'wh-slider-knob'}));
    valuewrappernode = dompack.create('div', { className : 'value-wrapper'});
    knobs[c].append(valuewrappernode);
    valuewrappernode.append(dompack.create('span', { className : 'value'}));
  }
  slidernode.append(...knobs);

  inputnode.after(replacenode);
  inputnode.style.display="none";

  var comp = new Slider(inputnode, replacenode, options);
  comp.knobs = knobs;

  //initial
  comp._onChanged();

  return comp;
}
