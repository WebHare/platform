/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import "@webhare/ts-esbuild-runner/src/polyfills";

if (!Array.prototype.at) { //not supported by Safari 15.3 and earlier
  Array.prototype.at = function (index) {
    const len = this.length;
    if (index < 0)
      index = len + index;
    return this[index]; //will return 'undefined' if index is out of range
  };
}
if (!String.prototype.at) { //not supported by Safari 15.3 and earlier
  String.prototype.at = function (index) {
    const len = this.length;
    if (index < 0)
      index = len + index;
    return this[index]; //will return 'undefined' if index is out of range
  };
}

///////////////////////////////////////////////////////////////////////////////
//
// ParentNode, ChildNode interfaces
//

//replaceChildren polyfill
if (!Element.prototype.replaceChildren) {
  //not generally supported by Chrome, Firefox and Safari before Oct 2020
  Element.prototype.replaceChildren = function () {
    this.innerHTML = "";
    this.append.apply(this, arguments);
  };
}

//
// end of ParentNode, Childnode
//
///////////////////////////////////////////////////////////////////////////////////
