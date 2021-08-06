/* Directly included JS by webinterface.witty:rootfailure component */
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
