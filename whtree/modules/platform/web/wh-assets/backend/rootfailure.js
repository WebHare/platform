/* Directly included JS by webinterface.witty:rootfailure component
   We've split this off to be able to work with Content-Security-Policy
   as errorhandlers cannot change HTTP Headers in the HareScript webserver
   (otherwise we would have integrated it into a single witty and use a nonce)
*/
var steps=0;
function showsteps()
{
  if(++steps>5)
  {
    steps = 0;
    document.documentElement.className='';
  }
  if(steps >= 1 && steps <= 3)
  {
    document.documentElement.className+= ' dots' + steps;
  }
}
setInterval(showsteps,600);
setInterval(function() { location.reload(true) },10000);
