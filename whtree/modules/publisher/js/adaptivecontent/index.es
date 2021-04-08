import * as dompack from 'dompack';
import * as beacons from './beacons';

//@cell(Date) now: The reference date to use when matching conditions
let dcoptions;

function testWidget(widget)
{
  if(widget.condition)
  {
    return matchCondition(widget.condition);
  }
  return { ok: `No conditions` };
}

function matchCondition(condition)
{
  switch (condition._type)
  {
    case "newvisitor":
    {
      if (beacons.getVisitCount() == 1)
        return { ok: `First visit` };
      else
        return { fail: `Subsequent visit` };
    }

    case "returningvisitor":
    {
      if (beacons.getVisitCount() == 1)
        return { fail: `First visit` };
      else
        return { ok: `Subsequent visit` };
    }

    case "beacon":
    {
      let since;
      if (condition.maxdays > 0)
      {
        since = dcoptions.now || new Date();
        since.setDate(since.getDate() - condition.maxdays);
      }
      if(beacons.isSet(condition.beacon, { since }))
        return { ok: `Beacon '${condition.beacon}' is set${since ? ` since ${since.toLocaleString()}` : ""}` };
      else
        return { fail: `Beacon '${condition.beacon}' is not set${since ? ` since ${since.toLocaleString()}` : ""}` };
    }

    case "visitbeforedate":
    {
      const date = new Date(condition.date);
      if ((dcoptions.now || new Date()) < date)
        return { ok: `It's before ${date.toLocaleString()}` };
      else
        return { fail: `It's after ${date.toLocaleString()}` };
    }

    case "visitafterdate":
    {
      const date = new Date(condition.date);
      if ((dcoptions.now || new Date()) >= date)
        return { ok: `It's after ${date.toLocaleString()}` };
      else
        return { fail: `It's before ${date.toLocaleString()}` };
    }

    case "and":
    {
      const results = [];
      for (const subcondition of condition.conditions)
      {
        const result = matchCondition(subcondition);
        if (!result.ok)
          return { fail: `AND Subcondition failed`, result };
        results.push(result);
      }
      return { ok: `All AND subconditions matched`, results };
    }

    case "or":
    {
      const results = [];
      for (const subcondition of condition.conditions)
      {
        const result = matchCondition(subcondition);
        if (result.ok)
          return { ok: `OR Subcondition matched`, result };
        results.push(result);
      }
      return { fail: `No OR subconditions matched`, results };
    }

    case "not":
    {
      const result = matchCondition(condition.condition);
      if (result.ok)
        return { fail: `NOT condition matched`, result };
      else
        return { ok: `NOT condition did not match`, result };
    }
  }

  return { fail: `Condition type '${condition._type}' not understood` };
}

async function handleAdaptiveContent(node)
{
  if (dompack.debugflags.connect)
    console.log("[connect] Handle adaptive content", node.dataset.name);
  //TODO geoip support etc

  const slot = node.dataset.slot;
  const slotjson = await(fetch(`/.publisher/slots/${slot}.json`));
  const slotinfo = await slotjson.json();

  //find widget to display
  let selectedwidget;
  for (const widget of slotinfo.widgets)
  {
    let testresult = testWidget(widget);
    if (dompack.debugflags.connect)
      console.log(`[connect] Show widget '${widget.name}' for '${node.dataset.name}'?`, testresult);
    if(!testresult.ok)
      continue;

    selectedwidget = widget;
    break;
  }
  if (!selectedwidget)
  {
    if (dompack.debugflags.connect)
      console.log(`[connect] Not showing any widget for '${node.dataset.name}'`);
    return;
  }

  if (dompack.debugflags.connect)
    console.log(`[connect] Showing widget '${selectedwidget.name}' for '${node.dataset.name}'`);

  //display the widget
  let newwidget = document.createElement("div");
  newwidget.innerHTML = selectedwidget.content;
  let toinsert = Array.from(newwidget.children);
  node.after(newwidget);
  toinsert.forEach(dompack.registerMissed);

  if(window.dataLayer)
    window.dataLayer.push({event: "wh:show-dynamic-content", whContentSlot: node.dataset.name, whContentSelected: selectedwidget.name});
}

export function setup(options)
{
  dcoptions = {...options};
  if (dcoptions.now && dompack.debugflags.connect)
    console.info("[connect] Using 'now' date", dcoptions.now);
  dompack.register("template.wh-adaptivecontent", handleAdaptiveContent);
}
