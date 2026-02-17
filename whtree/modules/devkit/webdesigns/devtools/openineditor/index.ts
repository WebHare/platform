import "./openineditor.scss";
import * as dompack from 'dompack';

function openInEditor(node: HTMLElement) {
  void fetch(`/.wh/devkit/openineditor/?open=${encodeURIComponent(node.dataset.resourceref!)}`);
}

//TODO merge these classes into one, and sync with WebHare ? (and namespace the data-resourceref to data-wh- something too then?)
dompack.register(".wh-hserror__resourceref, .devsite__openineditor", node => node.addEventListener("click", () => openInEditor(node)));
