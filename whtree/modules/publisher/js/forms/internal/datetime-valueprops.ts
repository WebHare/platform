/* eslint-disable */
/// @ts-nocheck -- These property hacks aren't simple to convert TS (and we may need an even more moden approach) so split them off for now

///////////////////////////////////////
//
// new 'value' property
//
function mySelectGetValue() {
  const origgetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value')!.get;
  //console.error("mySelectGetValue", origgetter, origgetter.apply(this));
  return origgetter.apply(this);
}
export function __setUnderlyingValue(comp, newvalue) {
  const origsetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(comp), 'value')!.set;
  if (origsetter) //this works on chrome, firefox and IE
  {
    origsetter.apply(comp, [newvalue]);
  } else {
    //safari doesn't let us call the original setter. but we _can_ remove the value property and it will be restored
    delete comp.value;
    comp.value = newvalue;
    setupMyValueProperty(comp); //reset our custom property
  }
}
function mySelectSetValue(newvalue) //this is invoked on external sets, and updates the replaced fields
{
  __setUnderlyingValue(this, newvalue);
  this._split_doupdate();
}

export function setupMyValueProperty(select) {
  Object.defineProperty(select, 'value', { configurable: true, get: mySelectGetValue, set: mySelectSetValue }); //FIXME why intercept get?
}

