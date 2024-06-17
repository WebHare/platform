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

export interface TolliumKeyboardShortcut {
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  keystr: string;
}

export type ShellInstruction = AppLaunchInstruction | WindowOpenInstruction | ResetImageCacheInstruction;
