import { decodeHSON } from "@webhare/hscompat";
import { toSnakeCase } from "@webhare/std";
import { type DefaultTreeAdapterMap, parse } from "parse5";


// All HTML elements to be separated by spaces
const SEPARATING_TAGS = [
  // Block level elements
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "OL", "UL", "PRE", "DL", "DIV",
  "NOSCRIPT", "BLOCKQUOTE", "FORM", "HR", "TABLE", "FIELDSET", "ADDRESS",
  // Other elements
  "BR", "TH", "TD", "LI"
];
// Don't index text within these tags
const SKIP_TAGS = [
  "SCRIPT", "STYLE", "INPUT", "TEXTAREA"
];


type ParsedPage = {
  success: boolean;                    // Successfully parsed
  knownmimetype: boolean;              // Is this a known mime type (only for errors)
  errormsg: string;                    // If not successful, contains error message
  typeExt: string;                     // Page type (file extension, e.g. "html", "pdf", etc.)
  indexPage: boolean;                  // Should this page be indexed?
  title: string;                       // Page title
  keywords: string;                    // Keywords to indentify this page
  description: string;                 // Description
  links: Array<{                       // Links found
    link: string;
    text: string;
    type?: string;
  }>;
  isdynamic: boolean;                  // Dynamic document?
  text: string;                        // Page body text
  extrafields: Record<string, string>; // Extra fields to submit with the page
};

function createParsedPage(): ParsedPage {
  return {
    success: true,
    knownmimetype: true,
    errormsg: "",
    typeExt: "",
    indexPage: true,
    title: "",
    keywords: "",
    description: "",
    links: [],
    isdynamic: false,
    text: "",
    extrafields: {},
  };
}

function cleanWhitespace(text: string) {
  if (!text)
    return text;

  // Change carriage returns, newlines, tabs and non-breaking spaces to spaces
  text = text.replaceAll("\r", " ");
  text = text.replaceAll("\n", " ");
  text = text.replaceAll("\t", " ");
  text = text.replaceAll("\xC2\xA0", " ");  // C2 A0 is the UTF-8 sequence for the &#160; character (non-breaking space)

  // Remove all extra spaces
  while (text.includes("  "))
    text = text.replaceAll("  ", " ");

  // Trim leading and trailing whitespace and return
  return text.trim();
}


/** @short Parse an HTML file
    @param htmlpage The page to parse
    @param contentlinksonly Only linkcheck links within wh_consilio_content?
    @return Information for the HTML page
    @cell return.success If page was parsed
    @cell return.errormsg If not parse, the error message
    @cell return.index_page This page should be indexed
    @cell return.title The page title
    @cell return.keywords Keywords for the page (from <meta name="keywords">)
    @cell return.description Description for the page (from <meta name="description">)
    @cell return.links The links found in this page
    @cell return.links.link The URL of the link
    @cell return.links.text The link text
    @cell return.links.type The link type, see mod::consilio/lib/parsers/parser_support.whlib for a list of values
    @cell return.isdynamic This is a dynamic page (i.e. not cached)
    @cell return.text The plain text contents of the page */
export async function parseHTMLPage(htmlPage: Blob) {
  // Does this page use <!--wh_consilio_content-->
  let consilioComments = false;
  // Structure to hold the parsed page
  const parsedPage = createParsedPage();
  parsedPage.typeExt = "html";
  // Path from current element [0] to the root element [END]
  const elementPath: string[] = [];
  // Last script id
  let lastScriptId = "";
  // Are we parsing the page's text? (Text within <!--wh_consilio_content-->
  // if found, within <body></body> otherwise)
  let parsingBody = false;
  // Actually adding text to body
  let addingText = false;
  // Previous callback was Text
  let previousText = false;
  // Currently processed hyperlink
  let curLinkHref = "";
  let curLinkText = "";
  // Frameset documents we've already seen
  const framesetDocs: string[] = [];
  // Image links we've already seen
  const imageLinks: string[] = [];

  function parseNode(node: DefaultTreeAdapterMap["node"]) {
    if (node.nodeName === "#document") {
      for (const childNode of (node as DefaultTreeAdapterMap["element"]).childNodes)
        parseNode(childNode);
    } else if (!node.nodeName.startsWith("#")) {
      elementStart(node.nodeName.toUpperCase(), (node as DefaultTreeAdapterMap["element"]).attrs);
      for (const childNode of (node as DefaultTreeAdapterMap["element"]).childNodes)
        parseNode(childNode);
      elementEnd(node.nodeName.toUpperCase());
    } else if (node.nodeName === "#text")
      text((node as DefaultTreeAdapterMap["textNode"]).value);
    else if (node.nodeName === "#comment")
      comment((node as DefaultTreeAdapterMap["commentNode"]).data);
  }

  function elementStart(elementName: string, attrs?: Array<{name: string; value: string}>) {
    // Uppercase attribute names
    if (attrs)
      attrs.forEach(attr => attr.name = attr.name.toUpperCase());

    previousText = false;

    // Add the element to the element path
    elementPath.unshift(elementName.toUpperCase());

    if (elementPath[0] === "META") {
      // We found meta information, check if we need it
      const name = attrs?.find(attr => attr.name === "NAME")?.value.toUpperCase();
      const httpEquiv = attrs?.find(attr => attr.name === "HTTP-EQUIV")?.value.toUpperCase();
      const content = attrs?.find(attr => attr.name === "CONTENT")?.value?.trim();

      if (content) {
        if (name === "ROBOTS") {
          // Search robot access control
          // The content attribute looks like "ALL" | "NONE" | "[NO]INDEX,[NO]FOLLOW".
          for (const robotTag of content.toUpperCase().split(",")) {
            switch (robotTag.trim()) {
              case "ALL": {
                parsedPage.indexPage = true;
                break;
              }
              case "NONE": {
                parsedPage.indexPage = false;
                break;
              }
              case "INDEX": {
                parsedPage.indexPage = true;
                break;
              }
              case "NOINDEX": {
                parsedPage.indexPage = false;
                break;
              }
            }
          }
        } else if (name === "KEYWORDS") {
          // Additional keywords for the page
          if (parsedPage.keywords)
            parsedPage.keywords += " ";
          // Check if these are language-specific keywords
          parsedPage.keywords += content;
        } else if (name === "DESCRIPTION") {
        // Page description
          parsedPage.description = content;
        } else if (httpEquiv === "PRAGMA" || httpEquiv === "CACHE-CONTROL") {
        // This could be a dynamic page
          parsedPage.isdynamic = parsedPage.isdynamic || content?.toUpperCase() === "NO-CACHE";
        } else if(name?.toUpperCase().startsWith("CONSILIO-") || name?.toUpperCase().startsWith("CONSILIO.")) {
          const fieldName = name.substring(9).toLowerCase();
          parsedPage.extrafields[fieldName] = content;
        }
      }
    } else if (elementPath[0] === "LINK") {
      const rel = attrs?.find(attr => attr.name === "REL")?.value.toLowerCase();
      const href = attrs?.find(attr => attr.name === "HREF")?.value;
      if (rel && href) {
        if (!["stylesheet","canonical"].includes(rel))
          parsedPage.links.push({ link: href, text: `[link: ${rel}]` });
      }
    } else if (elementPath[0] === "A") {
      // Found a hyperlink, add it to the list of links
      const href = attrs?.find(attr => attr.name === "HREF")?.value;
      const rel = attrs?.find(attr => attr.name === "REL")?.value;
      if (href && !rel?.toUpperCase().includes("NOFOLLOW"))
        curLinkHref = href;
    } else if (elementPath[0] === "FRAME") {
      // Found a frameset document
      const src = attrs?.find(attr => attr.name === "SRC")?.value;
      const name = attrs?.find(attr => attr.name === "NAME")?.value;
      if (src && !framesetDocs.includes(src)) {
        parsedPage.links.push({ link: src, text: `[frame${name ? `: ${name}` : ""}]` });
        framesetDocs.push(src);
      }
    } else if (elementPath[0] === "IMG") {
      const src = attrs?.find(attr => attr.name === "SRC")?.value;
      //const alt = attrs?.find(attr => attr.name === "ALT")?.value;
      if (src && !imageLinks.includes(src)) {
        // Get file name from image src
        const fname = src.slice((src.lastIndexOf("/") + 1) - src.length);
        imageLinks.push(src);
        if (curLinkHref)
          curLinkText += `[img: ${fname}]`;
      }
    } else if (elementPath[0] === "SCRIPT") {
      lastScriptId = attrs?.find(attr => attr.name === "ID")?.value ?? "";
    } else if (elementPath[0] === "BODY") {
      // Start parsing the body text, if page is not using comment
      if (!consilioComments) {
        parsingBody = true;
        addingText = true;
      }
    }
    if (addingText && SEPARATING_TAGS.includes(elementPath[0])) {
      // Add space for separating tags if we're adding body text
      parsedPage.text += " ";
    }
    if (SKIP_TAGS.includes(elementPath[0])) {
      // Don't add text for tags we don't want to index
      addingText = false;
    }
  }

  function elementEnd(_elementName: string) {
    previousText = false;

    if (elementPath[0] === "BODY") {
      // Stop parsing at end of body, even if we have consilio comments
      parsingBody = false;
      addingText = false;
    } else if (elementPath[0] === "A") {
      if (curLinkHref)
        parsedPage.links.push({ link: curLinkHref, text: curLinkText });
      curLinkText = "";
      curLinkHref = "";
    }

    // If the closed element was a skipped tag, re-enable adding of text
    // (the parser parses tags within these tags as text, so we can safely
    // assume no other tags were opened)
    if (SKIP_TAGS.includes(elementPath[0])){
      addingText = parsingBody;
    }

    // Remove element from element path
    elementPath.shift();
  }

  function text(value: string) {
    if (!elementPath.length)
      return; // Not parsing elements yet

    // Replace Unicode replacement characters (\uFFFD) with spaces
    // Tika replaces invalid character with Unicode replacement characters, we'll just replace those with spaces
    // See https://tika.apache.org/0.10/index.html
    // "Invalid characters are now replaced with the Unicode replacement character (U+FFFD), whereas before such characters
    //  were replaced with spaces, so you may need to change your processing of Tika's output to now handle U+FFFD"
    value = value.replaceAll("\uFFFD", " ");

    if (elementPath.length === 3 && elementPath[0] === "TITLE" && elementPath[1] === "HEAD" && elementPath[2] === "HTML")
      // We're currently parsing the document title
      parsedPage.title += (previousText || !parsedPage.title ? "" : " ") + value;

    if (elementPath[0] === "SCRIPT" && lastScriptId === "wh-consiliofields") {
      const decoded = value.startsWith("hson:") ? decodeHSON(value) : JSON.parse(value) as Record<string, string>;
      if (decoded) {
        for (const [ name, val ] of Object.entries(decoded)) {
          const fieldName = name.toLowerCase();
          parsedPage.extrafields[fieldName] = val;
        }
      }
    }

    if (addingText)
      // Add plain text to page text
      parsedPage.text += value;
    if (curLinkHref)
      curLinkText += (previousText || !curLinkText ? "" : " ") + value;

    previousText = true;
  }

  function comment(value: string) {
    previousText = false;

    if (value.trim().toUpperCase() === "WH_CONSILIO_CONTENT") {
      if (!consilioComments) {
        // Hey, we're parsing a page with consilio comment tags!
        parsedPage.text = "";
        consilioComments = true;
      }
      parsingBody = true;
      addingText = true;

    } else if (value.trim().toUpperCase() === "/WH_CONSILIO_CONTENT") {
      if (consilioComments) {
        parsingBody = false;
        addingText = false;
      }
    }
  }

  const document = parse(await htmlPage.text());
  parseNode(document);

  // Clean whitespace from string fields
  parsedPage.title = cleanWhitespace(parsedPage.title);
  parsedPage.keywords = cleanWhitespace(parsedPage.keywords);
  parsedPage.description = cleanWhitespace(parsedPage.description);
  parsedPage.text = cleanWhitespace(parsedPage.text);
  return parsedPage;
}

export async function parseHTMLPageForHareScript(htmlPage: Blob, _contentLinksOnly: boolean) {
  // For HareScript, snake-case the the field names and convert the extra fields from Record<string, string> to a { name,
  // value} array
  const parsed = toSnakeCase(await parseHTMLPage(htmlPage));
  return { ...parsed, extrafields: Object.entries(parsed.extrafields).map(([ name, value ]) => ({ name, value }))};
}
