import type { MaybePromise } from "@webhare/std";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/backend-integration" {
}

export interface FSObjectPolicyBaseContext {
  //TODO provide a getInstanceData to abstract away workflow choices around targetObject/contentObject ?
  targetObject: number | null;
  contentObject: number | null;
  targetParent: number;
  title: string;
}

export interface PublicationDefaults {
  start?: Temporal.Instant;
  end?: Temporal.Instant;
}

export interface FSObjectPolicy {
  /** Get default publication settings - mainly start & end publication date. Often overridden for news/events applications */
  getPublicationDefaults?(context: FSObjectPolicyBaseContext): MaybePromise<PublicationDefaults | null>;
  /** Calculate fallback meta (SEO) title for an object if not explicitly set. Used for display in editor */
  getFallbackMetaTitle?(context: FSObjectPolicyBaseContext): MaybePromise<string | null>;
}
