const blocklevel_elements = [
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "OL", "UL", "DL", "DIV",
  "NOSCRIPT", "BLOCKQUOTE", "FORM", "HR", "TABLE", "FIELDSET", "ADDRESS"
];

export function convertHtmlToPlainText(doc: HTMLElement, options: HTMLToPlainTextConverterOptions | number = {}, linkresolver?: (link: string) => string) {
  if (typeof options === "number") {
    // fallback for legacy arguments
    options = { imagehandling: options };
    if (linkresolver !== undefined)
      options.linkresolver = linkresolver;
  }
  options = { imagehandling: 0, linkresolver: undefined, suppress_urls: false, unix_newlines: false, ...options };
  const c = new HTMLToPlainTextConverter(doc, options);
  return c.plain_text;
}

type HTMLToPlainTextConverterOptions = {
  unix_newlines?: boolean;
  imagehandling?: number;
  linkresolver?: (link: string) => string;
  suppress_urls?: boolean;
};

type SAXCallbacks = {
  start_element: (name: string, attrs: Attr[]) => void;
  end_element: (name: string) => void;
  text_node: (data: string) => void;
};

class HTMLToPlainTextConverter {
  plain_text: string;
  ol: number;
  dont_break: boolean;
  hyperlink: string;
  hyperlink_text: string;
  first_cell: boolean;
  parsing_text: boolean;
  in_style_tag: boolean;
  in_title_tag: boolean;
  options: HTMLToPlainTextConverterOptions;

  constructor(doc: HTMLElement, options: HTMLToPlainTextConverterOptions) {
    this.plain_text = "";
    this.ol = -1;
    this.dont_break = false;
    this.hyperlink = "";
    this.hyperlink_text = "";
    this.first_cell = false;
    this.parsing_text = false;
    this.in_style_tag = false;
    this.in_title_tag = false;
    this.options = options;

    this.saxparse(doc,
      {
        start_element: (name, attrs) => this.plainElementStart(name, attrs),
        end_element: (name) => this.plainElementEnd(name),
        text_node: (data) => this.plainText(data)
      });

    //Never start text with a space/cr
    while ([" ", "\r", "\n"].includes(this.plain_text.substr(0, 1)))
      this.plain_text = this.plain_text.substr(1);

    // Normalize linefeeds to \r\n
    while (this.plain_text.indexOf("\r\n") >= 0)
      this.plain_text = this.plain_text.replace("\r\n", "\n");
    while (this.plain_text.indexOf("\r") >= 0)
      this.plain_text = this.plain_text.replace("\r", "\n");

    // Remove triple line breaks
    while (this.plain_text.indexOf(" \n") >= 0)
      this.plain_text = this.plain_text.replace(" \n", "\n");
    while (this.plain_text.indexOf("\n\n\n") >= 0)
      this.plain_text = this.plain_text.replace("\n\n\n", "\n\n");

    if (!this.options.unix_newlines)
      this.plain_text = this.plain_text.split("\n").join("\r\n");
  }

  saxparse(node: Node, callbacks: SAXCallbacks) {
    switch (node.nodeType) {
      case 1:
        {
          if (callbacks.start_element) {
            const attrs = Array.from((node as Element).attributes);
            callbacks.start_element(node.nodeName, attrs);
          }

          let child = node.firstChild;
          while (child) {
            this.saxparse(child, callbacks);
            child = child.nextSibling;
          }

          if (callbacks.end_element)
            callbacks.end_element(node.nodeName);
        } break;
      case 3:
        {
          if (callbacks.text_node)
            callbacks.text_node((node as Text).nodeValue || "");
        } break;
      case 9:
      case 11:
        {
          let child = node.firstChild;
          while (child) {
            this.saxparse(child, callbacks);
            child = child.nextSibling;
          }
        } break;
    }
  }

  getAttr(attrs: Attr[], field: string) {
    for (let idx = 0; idx < attrs.length; ++idx)
      if (attrs[idx].name.toUpperCase() === field)
        return attrs[idx].value;
    return "";
  }

  plainElementStart(name: string, attrs: Attr[]) {
    const tag = name.toUpperCase();
    if (blocklevel_elements.includes(tag)) { // Insert a newline for every content separating HTML node
      if (!this.dont_break)
        this.plain_text = this.plain_text + "\r\n";
      else
        this.dont_break = false;
    }
    switch (tag) {
      case "BR":                           // Break - insert newline
        {
          this.plain_text = this.plain_text + "\r\n";
        } break;
      case "STYLE":
        {
          this.in_style_tag = true; //ADDME: Also support SCRIPT, etc
        } break;
      case "TITLE":
        {
          this.in_title_tag = true; //ADDME: Also support SCRIPT, etc
        } break;
      case "A":                            // Hyperlink - remember link href to display after link text
        {
          this.hyperlink = this.getAttr(attrs, "HREF");
          this.hyperlink_text = "";
        } break;
      case "IMG":                         // Image - insert 'alt' text, if any
        {
          const alt = this.getAttr(attrs, "ALT");
          if (alt === "")
            return;

          this.plain_text = this.plain_text + (this.options.imagehandling === 1 ? "[[" : "[") + alt + "]";
        } break;
      case "UL":                           // Unordered list - set start value to -1 (don't display number)
        {
          this.ol = -1;
        } break;
      case "OL":                           // Ordered list - set start value to first number
        {
          const start = parseInt(this.getAttr(attrs, "START"));
          this.ol = Number.isNaN(start) ? 1 : start; // Number LI's, starting with value of start attribute,
          // or 1 if no or illegal start was given
          if (this.ol < 0)
            this.ol = 1;
        } break;
      case "LI":                           // Prefix list item with '*' or number value
        {
          if (this.ol === -1)
            this.plain_text = this.plain_text + "\r\n* ";
          else {
            const value = parseInt(this.getAttr(attrs, "VALUE"));
            this.ol = Number.isNaN(value) ? this.ol : value;
            this.plain_text = this.plain_text + "\r\n" + this.ol + ". ";
            this.ol = this.ol + 1;
          }
        } break;
      case "TR":                           // New table row - next table cell is the first in this row
        {
          this.first_cell = true;
        } break;
      case "TH":
      case "TD":                     // New table cell - print tab character between cells
        {
          if (!this.first_cell)
            this.plain_text = this.plain_text + "\t";
          else
            this.first_cell = false;

          // Don't insert a break before next block-level element
          this.dont_break = true;
        } break;
    }
  }

  textEqualsHyperlink(text: string, hyperlink: string) {
    if (this.options.linkresolver)
      hyperlink = this.options.linkresolver(hyperlink);

    if (text === hyperlink)
      return true;
    if (hyperlink === "mailto:" + text) //just a simple mailto link ?
      return true;
    if (hyperlink.startsWith("http://") && ("http://" + text === hyperlink || "http://" + text + "/" === hyperlink))
      return true;

    return false;
  }

  plainElementEnd(name: string) {
    // Print hyperlink href, if we have any
    if (!this.options.suppress_urls && name.toUpperCase() === "A" && this.hyperlink !== "") {
      if (!this.textEqualsHyperlink(this.hyperlink_text, this.hyperlink))
        this.plain_text = this.plain_text + " <URL:" + this.hyperlink + ">";
      this.hyperlink = "";
    }
    if (name.toUpperCase() === "STYLE")
      this.in_style_tag = false;
    if (name.toUpperCase() === "TITLE")
      this.in_title_tag = false;
    if (name.toUpperCase() === "TR")
      this.plain_text = this.plain_text + "\r\n";
  }

  plainText(text: string) {
    if (this.in_style_tag || this.in_title_tag)
      return;
    if (this.hyperlink !== "")
      this.hyperlink_text = this.hyperlink_text + text;

    // Change newlines/tabs/nbsps to spaces
    text = text.replace(/(\r|\n|\t|\u00A0)/g, " ");

    // Remove all extra spaces
    while (text.indexOf("  ") >= 0)
      text = text.replaceAll("  ", " ");

    this.plain_text = this.plain_text + text;
  }
}
