import { default as whtreeConfig } from './whtree/eslint.config.mjs';

function mapPaths(configArray) {
  for (const item of configArray) {
    if (!item.ignores)
      continue;

    item.ignores.forEach((path, idx) => {
      if (!path.startsWith("*"))
        item.ignores[idx] = "whtree/" + path;
    });
  }
  return configArray;
}

export default mapPaths(whtreeConfig);
