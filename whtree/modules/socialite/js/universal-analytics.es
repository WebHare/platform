/** import * as analytics from '@mod-socialite/js/universal-analytics.es'
*/

import * as dompack from 'dompack';

function event(category, action, label, value)
{
  //fixme: checkvalue, must be >0

  if (!category || category == "")
  {
    console.error("wh.google.analytics: 'category' is required");
    return;
  }
  if (!action || action == "")
  {
    console.error("wh.google.analytics: 'action' is required");
    return;
  }
  if(!label)
    label='';

  if (dompack.debugflags.anl)
    if (value > 0)
      console.log("[anl] Track event category = '" + category + "', action = '" + action + "', label = '" + label + "', value = '" + value + "'");
    else
      console.log("[anl] Track event category = '" + category + "', action = '" + action + "', label = '" + label + "'");

  if(!window.ga)
  {
    if (dompack.debugflags.anl)
      console.warn("[anl] Analytics does not appear to be integrated into the page");
    return;
  }
  window.ga('send', 'event', category, action, label);
}

/** page: The (name of the) page
    options: title: Only for universal analytics, optional title
*/
function pageview(page, options)
{
  /*
     'page' according to Google: Optional parameter to indicate what page URL to track metrics under. When using this option,
     use a beginning slash (/) to indicate the page URL.
   */
  if (page != "" && page.substring(0,1) != "/")
    page = "/" + page;

  let title = options && options.title ? options.title : '';

  if (dompack.debugflags.anl)
    console.log("[anl] Pageview, page = " + page + ", title = " + title);

  if(!window.ga)
  {
    if (dompack.debugflags.anl)
      console.warn("[anl] Analytics does not appear to be integrated into the page");
    return;
  }

  window.ga('send', 'pageview', {page,title});
}

module.exports = { event: event
                 , pageview: pageview
                 };
