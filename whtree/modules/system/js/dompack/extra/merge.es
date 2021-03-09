const formatters = {}, updaters = {};

function mergeNode(node, set, data)
{
  const parts = set.split(":");
  const isNodeFunc = parts.length === 1;
  if (parts.length > 2)
  {
    console.error(`Illegal merge expression: '${set}'`, node);
    return;
  }

  let func;
  let exprpath = (isNodeFunc ? parts[0] : parts[1]).trim();

  const callparts = exprpath.split("(");
  if (callparts.length > 1)
  {
    if (callparts.length !== 2)
    {
      console.error(`Illegal merge value: '${set}'`, node);
      return;
    }

    func = callparts[0].trim();
    const funcrest = callparts[1].split(")");
    if (funcrest.length !== 2 || funcrest[1] !== "")
    {
      console.error(`Illegal merge value: '${set}'`, node);
      return;
    }
    exprpath = funcrest[0].trim();
  }

  let value = data;
  if (exprpath !== "*")
  {
    const exprpathparts = exprpath.split(".");
    for (let i = 0; i < exprpathparts.length; ++i)
    {
      value = value[exprpathparts[i].trim()];
      if (typeof value === "undefined")
        return;
    }
  }

  if (isNodeFunc)
  {
    if(func && updaters[func])
      updaters[func](node, value);
    else if (func)
      console.error(`Unknown updating function '${func}' in '${set}'`, node);
    else
      console.error(`A function is required for merges without a property (in '${set}')`, node);
    return;
  }

  const prop = parts[0].trim();
  if (func)
  {
    if(formatters[func])
      value = formatters[func](value);
    else
    {
      console.error(`Unknown formatting function '${func}' in '${set}'`, node);
      return;
    }
  }

  if (typeof value !== "string" && typeof value !== "number")
  {
    console.error(`Got a value of type ${typeof value} in '${set}'`, node);
    return;
  }

  switch (prop)
  {
    case 'events':
    case 'styles':
    case 'children':
    case 'on':
    case "className":
    case "class":
    case 'style':
    case 'dataset':
    case 'childNodes':
    {
      console.error(`Cannot modify '${prop}' with merge`, node);
      return;
    }
    default:
    {
      // 1-to-1 name to property mapping
      node[prop] = value;
      return;
    }
  }
}

/** Apply all merge fields within a node, recursively
    @param node Root node to start merging
    @param data Merge data
    @param options
    @cell options.filter If set, a function that will be called for every node with merge functions. If it returns a falsy value, the node will be skipped.
*/
export async function run(node, data, { filter } = {})
{
  let nodes = node.querySelectorAll('*[data-merge],*[data-wh-merge]');
  for(let node of Array.from(nodes)) //FIXME drop support for data-wh-merge as soon as we've completed the phase out
  {
    if (filter && !filter(node))
      continue;

    // Parse 'a=b;c=d(e)'
    let sets = (node.dataset.merge || node.dataset.whMerge).split(";");
    for (let set of sets)
      mergeNode(node, set, data);
  }
}

/** Register a formatter function.
    @param name Name of the formatter function
    @param callback Formatter function. Called with parameter (value), must return a formatted value to write to the property.
*/
export function registerFormatter(name, callback)
{
  formatters[name] = callback;
}

/** Register an updater function (used to update multiple properties of a node at once)
    @param name Name of the updater function
    @param callback Updater function. Called with parameters (node: HTMLElement, value: Any).
*/
export function registerUpdater(name, callback)
{
  updaters[name] = callback;
}
