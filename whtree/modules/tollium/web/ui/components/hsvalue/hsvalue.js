function toggleMe(evt)
{
  evt.preventDefault();

  const branchnode = this.parentNode;

  const show = branchnode.classList.contains("closed");
  toggleBranch(branchnode, show);
}

function toggleBranch(branchnode, show)
{
  /*
  <ul> - Used for arrays
  .content - Used as wrapper around the description on non-array content
  .interpreted - human description of the content (WHFSObject)
  */
  const subcontentnode = branchnode.querySelector(":scope > ul, :scope > .interpreted, :scope > .content");

  if (show)
  {
    branchnode.classList.remove("closed");
    branchnode.classList.add("open");
    subcontentnode.removeAttribute("hidden");
  }
  else
  {
    branchnode.classList.add("closed");
    branchnode.classList.remove("open");
    subcontentnode.setAttribute("hidden", "until-found");
  }
}

function closeall()
{
  const headers = document.body.querySelectorAll(".header");
  for (let idx = 0; idx < headers.length; idx++)
  {
    const branchnode = headers[idx].parentNode;
    toggleBranch(branchnode, false);
  }
}

function openall()
{
  const headers = document.body.querySelectorAll(".header");
  for (let idx = 0; idx < headers.length; idx++)
  {
    const branchnode = headers[idx].parentNode;
    toggleBranch(branchnode, true);
  }
}

// when the browser found a text match within a hidden part of the content
// whe'll have to update our own closed and open classes so we can style the toggle header
// which is outside/above the hidden content.
// (We could use :has nowadays, but it might be costly in performance)
function onFoundMatch(evt)
{
  let opennode = evt.target.closest(".closed");
  while(opennode)
  {
    opennode.classList.remove("closed");
    opennode.classList.add("open");
    opennode = evt.target.closest("closed");
  }
}

document.body.addEventListener("beforematch", onFoundMatch);

//loaded at bottom of <body> so this should all exist
document.getElementById("openall").addEventListener("click", openall);
document.getElementById("closeall").addEventListener("click", closeall);
Array.from(document.querySelectorAll(".toggleme")).forEach( function(node) { node.addEventListener("click", toggleMe); });
