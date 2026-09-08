// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/backend-integration" {
}

export interface FSObjectPolicyBaseContext {
  fsObject: number;
}

export interface PublicationDefaults {
  start?: Temporal.Instant;
  end?: Temporal.Instant;
}

export interface FSObjectPolicy {
  /** Get default publication settings - mainly start & end publication date. Often overridden for news/events applications */
  getPublicationDefaults?(context: FSObjectPolicyBaseContext): Promise<PublicationDefaults | null>;
}
