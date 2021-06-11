//Polyfills still needed in compatiblity=modern mode (AND IE11/Edge mode)


///////////////////////////////////////////////////////////////////////////////
//
// ParentNode, ChildNode interfaces
//

//replaceChildren polyfill
if(!Element.prototype.replaceChildren)
{
  Element.prototype.replaceChildren = function()
  {
    this.innerHTML = "";
    this.append.apply(this, arguments);
  };
}

//
// end of ParentNode, Childnode
//
///////////////////////////////////////////////////////////////////////////////////

if(!window.__whCompatibility)
  window.__whCompatibility = "modern";
