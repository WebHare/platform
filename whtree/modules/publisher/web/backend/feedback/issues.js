// Scroll to bottom upon page load
window.addEventListener("load", () => document.body.lastChild.scrollIntoView({ block: "end" }));

// Move screenshotdata into a frame
const screenshotholder = document.querySelector("#screenshotholder");
if(screenshotholder) {
  const frame = document.createElement("iframe");
  frame.srcdoc = atob(screenshotholder.querySelector("template").content.textContent);
  screenshotholder.replaceChildren(frame);
}
