/** Manages page level metadata */
export class PageMetaData {
  viewport: string;
  htmlClasses: string[] = [];

  constructor() {
    this.viewport = "width=device-width, initial-scale=1.0";
  }
}
