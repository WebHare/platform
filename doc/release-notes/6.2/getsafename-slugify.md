## Breaking changes

### `GetSafeName` and `GetSafeFileName` replace unsafe characters with a hyphen
HareScript's `GetSafeName` (`wh::util/langspecific.whlib`) and `GetSafeFileName` (`wh::files.whlib`) now follow
`slugify` from `@webhare/std`: every run of characters that isn't kept becomes a single hyphen. They used to turn only
spaces, hyphens, underscores and non-breaking spaces into a hyphen and removed all other characters. Names never start
or end with a hyphen, and `GetSafeFileName` no longer writes a hyphen right before a dot.

| Input | 6.1 | 6.2 |
|---|---|---|
| `F+R With Shadows` | `fr-with-shadows` | `f-r-with-shadows` |
| `What's new?` | `whats-new` | `what-s-new` |
| `Q&A` | `qa` | `q-a` |
| `v1.2` with `GetSafeName` | `v12` | `v1-2` |
| `a+b.txt` with `GetSafeFileName` | `ab.txt` | `a-b.txt` |
| `Draft _.pdf` with `GetSafeFileName` | `draft-.pdf` | `draft.pdf` |
| `.Über '12' _Straßen_.?` with `GetSafeFileName` | `uber-12-strassen-` | `uber-12-strassen` |
| `My Photo (1)` | `my-photo-1` | `my-photo-1` |

Names without punctuation or symbols don't change, and neither does how letters are normalized (eg. `é` to `e`, `ß` to
`ss`, `æ` to `ae`). Zero width spaces, soft hyphens and other characters that can't be converted to a-z (eg.
`ł`, `đ` or `€`) now become a hyphen too. Control characters and combining accents are still removed.

This affects names that WebHare generates from now on:

- the name the Publisher suggests for a new file or folder based on its title, and the names that `GenerateUniqueName`
  and archive imports give to uploaded files whose name isn't a valid WHFS name (eg. `goud|vis.png` is now stored as
  `goud-vis.png`, not `goudvis.png`)
- the anchors `GenerateAnchor` generates for headings: links to `#whats-new` on a page have to be updated to
  `#what-s-new` once the page is republished
- the file name at the end of the URLs that `GetCachedImageLink` and `GetCachedFileLink` return when no `filename` is
  passed, eg. `.../a-b.jpg` instead of `.../ab.jpg` for an image named `a+b.jpg`. Links with the old name keep working,
  as the name isn't used to find the image or file
- file names of downloads and exports: spreadsheet and column exports, files in form result exports, PDFs created by
  `mod::system/lib/printer.whlib`, WebDAV downloads and WRD schema exports, and the file names `wh::internet/http.whlib`
  sends in multipart form posts
- the default WRD login cookie name for WRD schemas whose name contains characters other than letters, digits, `_` and
  `:` (eg. `webharelogin-example-nl` instead of `webharelogin-examplenl` for `example.nl`). This now matches the name
  `@webhare/auth` expects. Visitors of sites using such a schema have to log in again once after the upgrade

Existing files and folders are not renamed. Module code that stores the result of `GetSafeName` or `GetSafeFileName`
(eg. as a tag or slug) and later compares it to a freshly generated name has to regenerate the stored values, and URLs
built from such names change for titles with punctuation in them.

The `tohyphens` option of `GetSafeName` is no longer needed to turn a character into a hyphen. It still works, and is
only useful for characters that the `safedots` or `utf8` option keeps.
