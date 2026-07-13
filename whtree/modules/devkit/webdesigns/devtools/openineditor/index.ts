import "./openineditor.scss";

function openInEditor(node: HTMLElement) {
  void fetch(`/.wh/devkit/openineditor/?open=${encodeURIComponent(node.dataset.resourceref!)}`);
}

document.documentElement.addEventListener("click", node => {
  const resourceRef = (node.target as HTMLElement).closest<HTMLElement>(".wh-hserror__resourceref");
  if (resourceRef) {
    openInEditor(resourceRef);
  }
});
