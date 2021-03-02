WARNING: this documentation was written when dompack was a separate module and may be out of date

# Dompack JSX support

With dompack.create, DOM elements can be created quickly. However, when building larger trees of html, the resulting code can become a bit unreadable. With the Dompack JSX support, the tree can be written in JSX, resulting in cleaner syntax.

Dompack directly creates HTML elements from the JSX (like nativejsx, but using standard Babel JSX). This differs from React, which creates virtual DOM elements (ReactElement), and later syncs those to the DOM.

The properties on elements are passed directly to dompack.create, so they can be a bit different from normal React node properties.

## Quick example

Let's take a simple text and a following input. Using dompack.create, this can be written as follows:
```jsx
let count = 1;
let node = dompack.create("div", { childNodes:
              [ dompack.create("span", { textContent: "Search: " })
              , dompack.create("input", { on: { input: this._handleInput } })
              [ dompack.create("span", { textContent: " (" + count + " searches)" })
              ]});
```

Using dompack JSX extensions, this can be written as:

```jsx
// Ensure dompack.jsxcreate is used to instantiate JSX nodes. Needed only once.
/* @jsx dompack.jsxcreate */

let count = 1;
let node = <div>
             <span>Search: </span>
             <input on={ input: this._handleInput } />
             <span> ({count} searches)</span>
           </div>;
```

# How to use JSX

In JSX, all standard DOM-nodes names must be lowercase. Properties can be passed in a few ways:
- With a string: `<span textContent="text" />`
- With a variable: `<span textContent={item.title} />`
- All properties in an object `<span {...item} />`

The content of nodes is passed as-is, but content within `{ }` is executed as a javascript expression.
Examples:
- String: `<span>Number of items {itemcount}.<span>`
- Nodes: `<div><span>text</span>span><div>`
- Childnodes from expressions: `<ul>{ menuitems.map(item => <li>{item.title}</li>) }</ul>`

Block comments can be used whenenclosed in '{ }'.
Example:
- `{/* A JSX comment */}`


## JSX components

The Dompack JSX binding has limited support for creating components. These can be used to create reusable pieces of code, or to keep standalone components simple. Dompack only supports using functions for components (React also supports component classes).

Example:

```jsx
/* @jsx dompack.jsxcreate */

// Component names MUST start with an uppercase letter
function MenuItem(allprops)
{
  // The properties are passed in one object (in this case, allprops).
  return <li on={ click: onMenuItemClick(allprops) }>
           <span>{allprops.title}</span>
         </li>;
}

let menuitems = getMenuItems();
let menu =
    <ul>
      {menuitems.map(item => <MenuItem {...item} />)}
    </ul>;
```

The syntax `<MenuItem {...item} />` is used to pass the contents of the item object directly to the MenuItem component.

## Store references to nodes while creating them inline

With dompack.create, references to elements can be saved easily when creating them at the top-level of the function.
This can be done inline in JSX with:

```jsx
/* @jsx dompack.jsxcreate */

let innerinput;
let node = <div>
             <span>Text: </span>
             {innerinput = <input />}
           </div>;
```

# Large example

This is a real-world example of the rewriting of the application menu code in tollium. Not all changes of the surrounding code have been included.

```jsx
function createAppMenu(items)
{
  let apps = [];
  items=items.map(item=>
  {
    const itemapps = [];
    let header = [ dompack.create("span", { textContent: item.title })
                 ];
    if(item.editinstr)
    {
      let cogimage = toddImages.createImage("tollium:objects/cog2",16,16,"w", { className: "dashboard__editgroupicon"
                                                                              , title: item.edittitle
                                                                              });
      let editnode = dompack.create("span", { className: "dashboard__editgroup"
                                            , childNodes: [ cogimage ]
                                            });
      header.push(editnode);
    }
    let appnodes = item.apps.map(app =>
    {
      let node = dompack.create("li",
        { childNodes:
           [ dompack.create("div", { childNodes:
             [ app.icon ? toddImages.createImage(app.icon, 16, 16, "w", { className: "dashboard__appicon" }) : null
             , dompack.create('span', { className: "dashboard__apptitle", textContent: app.title })
             ]})
           ]
        , className: { "dashboard__app": true }
        });
      itemapps.push({ node: node, title: app.title, groupnode: null });
      return node;
    });
    let groupnode = dompack.create("li", { childNodes: [ dompack.create("div", { childNodes: header })
                                                       , dompack.create("ul", { childNodes: appnodes })
                                                       ]
                                         , className: { "dashboard__menuitem": true }
                                         });
    itemapps.forEach(a => a.groupnode = groupnode);
    apps.push(...itemapps);
    return groupnode;
  });
}
```

This was translated to:

```jsx
function _createAppMenu(items)
{
  function ToddImage({ image, width, height, color, ...props })
  {
    return toddImages.createImage(image, parseInt(width), parseInt(height), color, props);
  }

  // Single menu item with an app
  let AppMenuItem = (app) =>
      <li className={{ "dashboard__app": true }} app={app}
          on={{ click: e => this._onMenuClick(e, app.instr) }} >
        <div>
          {app.icon ? <ToddImage image={app.icon} width="16" height="16" color="w"
                                 className="dashboard__appicon" /> : null}
          <span className="dashboard__apptitle">{app.title}</span>
        </div>
      </li>;

  // Menu section
  let AppMenuSection = (item) =>
      <li className="dashboard__menuitem">
        <div>
          <span>{item.title}</span>
          {item.editinstr &&
            <span className="dashboard__editgroup"
                  on={{ click: e => this._onMenuClick(e, item.editinstr) }} >
              <ToddImage image="tollium:objects/cog2" width="16" height="16" color="w"
                         className="dashboard__editgroupicon"
                         title={item.edittitle} />
            </span>}
        </div>
        <ul>
          {item.apps.map(app => <AppMenuItem {...app} />)}
        </ul>
      </li>;

  let retval =
    <nav className="dashboard__apps">
      {items.map(item => <AppMenuSection {...item} />)}
    </nav>;

  setMenuLiVisible(retval.querySelector(".dashboard__search"), false);
  return retval;
}
```

