export type AppLaunchInstruction = {
  type: "appmessage";
  app: string;
  target: unknown;
  message: unknown;
  reuse_instance: "always" | "whennotbusy" | "never";
  inbackground: boolean;
};

type WindowOpenInstruction = {
  type: "windowopen";
  link: string;
};

type ResetImageCacheInstruction = {
  type: "shell:resetimagecache";
};

export type ShellInstruction = AppLaunchInstruction | WindowOpenInstruction | ResetImageCacheInstruction;
