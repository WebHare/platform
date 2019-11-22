/* Implements whq

   Pages requiring the whq should add the following code to the top
   of their <head>

   <script>window.whq=window.whq||[]</script>

   For witties:
   <script>window.whq=window.whq||[[]</script>
*/

window.whq = window.whq || [];
let eventregistry=[];

if(window.whq._regged)
{
  console.error("Duplicate whq (WebHare queue) registration - wh/queue is loaded twice?");
}
else
{
  window.whq._regged=true;
  window.whq.push = function(...toadd)
  {
    toadd.forEach(function(evt)
    {
      window.whq.splice(window.whq.length, 0, evt);
      if(eventregistry[evt.type])
        eventregistry[evt.type](evt);
    });
  };
}

export function addHandler(type, callback)
{
  if(eventregistry[type])
    throw new Error("Duplicate queue handler registration for '" + type + "'");

  eventregistry[type]=callback;
  window.whq.filter(e => e.type === type).forEach(e => callback(e));
}
