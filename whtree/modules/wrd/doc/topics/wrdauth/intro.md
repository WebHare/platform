# Wrdauth setup

# Security considerations
Authentication and authorization systems cannot be fully enforced on the client. The wrdauth JS api is intended to ease integration into websites, but you should not rely on eg the 'wh-wrdauth--isloggedin' class to hide sensitive information from users who are not logged in.

Please note that the wrdauth JS api cannot access the real login cookies - these are all marked as 'HttpOnly' to prevent the cookies from escaping in a XSS attack.

