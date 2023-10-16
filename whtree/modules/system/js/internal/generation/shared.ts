export interface FileToUpdate {
  path: string;
  module: string; //'platform' for builtin modules
  type: string;
  generator: (options: GenerateOptions) => string | Promise<string>;
}

export interface GenerateOptions {
  verbose?: boolean;
}
