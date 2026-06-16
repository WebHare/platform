// Temporary library implementing __ICU_FormatDuration in TypeScript for WH5.9

export function formatDuration(value: Record<string, unknown>, locale: string, options: Record<string, unknown>) {
  for (const [key, val] of Object.entries(options)) {
    // Remove empty values
    if (!val)
      delete options[key];
    else if (key.endsWith("display")) {
      // Rewrite 'xxxdisplay' options to 'xxxDisplay'
      options[key.replace(/display$/, "Display")] = options[key];
      delete options[key];
    } else if (key === "fractionaldigits") {
      // Rewrite 'fractionaldigits' options to 'fractionalDigits'
      options["fractionalDigits"] = options[key];
      delete options[key];
    }
  }

  try {
    //@ts-expect-error Requires TS 6.0.2
    const formatted = new Intl.DurationFormat(locale, options).format(value);
    return formatted;
  } catch (e) {
    return "";
  }
}
