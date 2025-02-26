//moved here to share with devkit. we might consider moving the SDK stuff to devkit as well? they're not designed in a
export type PackageJson = {
  version?: string;
  main?: string;
  private?: boolean;
  files?: string[];
  keywords?: string[];
  dependencies?: Record<string, string>;
};

