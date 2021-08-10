# Background information on wrdauth

## Cookies
The WebHare webserver can accelerate loginchecks if they're associated with a session whose ID is stored
in a recognizeable cookie. Such a cookie's name must start with `webharelogin`, followed by characters in the range `0-9`, `a-z` or `-`
and an optional `_e` suffix. Any other underscored suffixes are ignored.

For any cookie matching the pattern, its encoded contents until the first percent sign are taken. This value if is looked up
in th session cache. If the cookie matches a valid session and that session has already been authorized for the current
access rule, the authentication script is ignored. The requirements this validation places on the cookie structure is
also the reason for wrdauth cookies always atarting with 'webharelogin'.

The wrdauth cookie name (eg `webharelogin-backend`) is used as the a base name for various related cookies

### Login cookie
The actual login cookie has no suffix. It stores the sessionid, followedby a space and then an encrypted dataset containing
the user's id and the login session parameters. This cookie will have a set expiry date if a persistent login was requested
and will otherwise be a session-only cookie.

This cookie is a session cookie and is not readable from JavaScript.

### JavaScript cookies
Some information about the loggedin user is made visible to JavaScript so static pages can eg. show
the user's firstname or email address as part of a 'logged in' indication. This data is stored in the `_j` and `_c` cookies.

The `_c` cookie is a session cookie which contains the requested userinfo for use by JavaScript. The `_j` cookie is a
long lived cookie which is used by the JavaScript code as a hint that the current user is logged in. The presence of `_j`
but not `_c` may trigger a redirect to restoresession.shtml to verify that the login session is still valid and to rebuild
the `_c` cookie with the requested user information.

The `_j` and `_c` cookies are not marked `httpOnly` so JavaScript can access their contents and restore loginstate when
needed even on static HTML pages. These cookies do not contain actual login state so leaking their data will not allow third
parties to access login sessions. However, they may still contain personal information so your code should still be safe from
XSS vulnerabilities. (But this applies to all data available to JavaScript)


## Login flow examples

### Access rule logins
Login requirements defined by access rules (such as 'all users must login using their WebHare account')
are handled by `webhare-auth.whscr`. The actual flow when accessing a site on an external host is as follow:

1. User requests a login-protected page, eg `https://www.example.com/`
2. webhare-auth.whscr is invoked and does not see any cookie for the local domain.
   The user is redirected to `https://webhare.example.net/.wrd/auth/gologin` with a logincontrol token containing
   instructions to redirect back to `https://www.example.com/` after login.
3. gologin checks whether the user is logged in on `webhare.example.net`. If so,
   it will execute the afterlogin redirection and continues from step 5. If not, it will clear
   the login cookies and redirect the user to the WebHare interface to login
4. The user is requested to login.
5. The user is redirected back to the original url, with a proof as URL variable
6. webhare-auth.whscr is invoked again and processes the proof to log the user in.

When a site is previewed in the Publisher, the above approach doesn't usually work - login samesite
restrictions will prevent the iframe from seeing the login cookies (step 3) causing the user to
be logged out (and step 4 is also prevented in an iframe). In 4.22, step 2 will check for the
'preview' cookie and a sessionStorage flag to detect whether it's running in the Publisher iframe.
If so, it will directly connect with the wrd challenge/proof mechanism (using postMessage) and
use the proof to resume at step 5.
