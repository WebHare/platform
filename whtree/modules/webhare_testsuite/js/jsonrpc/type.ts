export interface MyService {
  /** Validate an e-mail address
   *
   * @param emailaddress - Address to validate
   * @returns Validation result
   */
  validateEmail(langcode: string, emailaddress: string): Promise<boolean>;

  ///Test error handling
  serverCrash(): void;

  ///Describe me!
  describeMyRequest(): Promise<{
    baseURL: string;
    url: string;
    requestHeaders: Record<string, string>;
    debugFlags: string[];
  }>;

  doConsoleLog(): Promise<null>;

  lockWork(): Promise<void>;
}
