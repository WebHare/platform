function toggleMe()
{
  var togglenode = this.parentNode;
  togglenode.classList.toggle("closed");
  togglenode.classList.toggle("open");
}
function closeall()
{
  var headers = document.body.querySelectorAll(".header");
  for (var idx = 0; idx < headers.length; idx++)
  {
    var node = headers[idx].parentNode;
    node.classList.remove("open");
    node.classList.add("closed");
  }
}
function openall()
{
  var headers = document.body.querySelectorAll(".header");
  for (var idx = 0; idx < headers.length; idx++)
  {
    var node = headers[idx].parentNode;
    node.classList.add("open");
    node.classList.remove("closed");
  }
}

//loaded at bottom of <body> so this should all exist
document.getElementById("openall").addEventListener("click", openall);
document.getElementById("closeall").addEventListener("click", closeall);
Array.from(document.querySelectorAll(".toggleme")).forEach( function(node) { node.addEventListener("click", toggleMe); });
