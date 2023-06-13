/// script to warn you about use of *.es imports which can be replaced (remove the extension)
import { islive } from "@webhare/env";

const warnings = new Set;

function flushESWarnings() {
  if (islive)
    return;

  console.warn("[WH Deprecation warning] You should update the import for the following libraries to remove the '.es' extension:\n- " + [...warnings.values()].join("\n- "));
  console.warn("[WH Deprecation warning] See also: https://www.webhare.dev/blog/avoid-es-extension/");
  warnings.clear();
}

export function warnESFile(path: string) {
  if (warnings.size === 0) //list is empty
    setTimeout(flushESWarnings, 1);

  warnings.add(path);
}
