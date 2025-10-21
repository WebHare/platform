import "typeface-roboto";
import { type EventMapType, TypedEventTarget } from "@mod-tollium/web/ui/js/support/typedeventtarget";

declare global {
  interface GlobalEventHandlersEventMap {
    "tollium-iframe-api:theme-change": CustomEvent<{ name: string }>;
  }
}

interface ThemeEventMap extends EventMapType {
  "change": CustomEvent<null>;
}

// Tollium theme settings (keep in sync with ../styling/tollium.css!)

// 'default' theme
const root = {
  // Colors
  colorAccent: "#308fe2",

  // Backgrounds
  background: "#ffffff",
  backgroundShaded: "#f8f8f8",
  backgroundFooter: "#e5e5e5",
  backgroundSelected: "#95cdfe",
  backgroundBlurred: "#e1e1e1",

  // Borders
  borderColor: "#b3b3b3",
  borderColorFocus: "#52aefe",
  borderColorDisabled: "#c9c9c9",
  borderWidth: 1,//px
  lineColor: "#4a4a4a",

  // Text
  textColor: "#333333",
  textColorDisabled: "#c9c9c9",
  fontFamily: "Roboto, Helvetica, Arial, sans-serif",
  fontSize: 12,//px

  // Inputs
  inputBackground: "#fbfbfb",
  inputBackgroundRequired: "#fcf8d0",
  borderRadius: 2,//px

  // Layout
  padding: 10,//px
};

/** The currently active theme settings */
class Theme extends TypedEventTarget<ThemeEventMap> {
  #name = "";
  #settings?: typeof root;

  /** The currently active theme name */
  get name() {
    return this.#name;
  }

  /** The accent color, used by headings */
  get colorAccent() { return this.#settings!.colorAccent; }
  /** The background color */
  get background() { return this.#settings!.background; }
  /** A slightly shaded background color */
  get backgroundShaded() { return this.#settings!.backgroundShaded; }
  /** The footer background color */
  get backgroundFooter() { return this.#settings!.backgroundFooter; }
  /** The background color of selected items when focused */
  get backgroundSelected() { return this.#settings!.backgroundSelected; }
  /** The background color of selected items when blurred */
  get backgroundBlurred() { return this.#settings!.backgroundBlurred; }
  /** The border color */
  get borderColor() { return this.#settings!.borderColor; }
  /** The border color of focused components */
  get borderColorFocus() { return this.#settings!.borderColorFocus; }
  /** The border color of disabled components */
  get borderColorDisabled() { return this.#settings!.borderColorDisabled; }
  /** The default border width */
  get borderWidth() { return this.#settings!.borderWidth; }
  /** The color of icon lines */
  get lineColor() { return this.#settings!.lineColor; }
  /** The text color */
  get textColor() { return this.#settings!.textColor; }
  /** The text color of disabled components */
  get textColorDisabled() { return this.#settings!.textColorDisabled; }
  /** The font family */
  get fontFamily() { return this.#settings!.fontFamily; }
  /** The default font size */
  get fontSize() { return this.#settings!.fontSize; }
  /** The default font definition */
  get font() { return `${this.#settings!.fontSize} ${this.#settings!.fontFamily}`; }
  /** The font definition for headings */
  get headingFont() { return `500 13px/120% ${this.#settings!.fontFamily}`; }
  /** The heading text color */
  get headingColor() { return this.#settings!.colorAccent; }
  /** The background of input components */
  get inputBackground() { return this.#settings!.inputBackground; }
  /** The background of required input components */
  get inputBackgroundRequired() { return this.#settings!.inputBackgroundRequired; }
  /** The component border radius */
  get borderRadius() { return this.#settings!.borderRadius; }
  /** The default padding between elements in the interface */
  get padding() { return this.#settings!.padding; }

  constructor() {
    super();

    // Check for a 'tollium-theme' search param
    const name = new URL(location.href).searchParams.get("tollium-theme");
    // Set the theme, fall back to 'default'
    this.#setName(name || "default");

    // Update the theme upon theme change events (these are either fired by the Tollium interface when the user changes the
    // the theme or by processMessage within Tollium iframes)
    window.addEventListener("tollium-iframe-api:theme-change", event => this.#setName(event.detail.name));
  }

  #setName(name: string) {
    if (name === this.#name)
      return;

    // Update the theme settings
    switch (name) {
      default: {
        if (name !== "default") {
          console.warn(`Unknown theme '${name}', falling back to 'default'`);
          name = "default";
          if (name === this.#name)
            return;
        }
        this.#settings = root;
      }
    }
    this.#name = name;

    // Update the html class to reflect the currently active theme
    for (const className of document.documentElement.classList)
      if (className.startsWith("tollium-theme-"))
        document.documentElement.classList.remove(className);
    document.documentElement.classList.add(`tollium-theme-${this.#name}`);

    // Emit a 'change' event (the Tollium iframe components listens to this to propagate theme changes to iframes, loaded
    // iframes can listen for this event to handle theme updates that need more processing than just updated CSS variables)
    this.dispatch("change", null);
  }
}

let theme: Theme | null = null;

export function getTheme(): Theme {
  if (!theme)
    theme = new Theme();
  return theme;
}
