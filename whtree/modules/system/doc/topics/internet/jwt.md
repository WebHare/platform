# JSON Web Tokens

Creating a JSON Web Token:

```harescript
OBJECT jwt := NEW JSONWebToken("ES256", BlobToString(GetDiskResource("/path/to/pem-encoded-ecdsa-key")));
jwt->payload :=
    [ iat := GetCurrentDateTime()
    , exp := AddDaysToDate(1, GetCurrentDateTime())
    ];
STRING authvalue := jwt->GetAuthorizationValue();
```

If you're using claim names with uppercase characters, you can use %JSONWebToken::SetPayload to supply JSON translations:

```harescript
OBJECT jwt := NEW JSONWebToken("ES256", BlobToString(GetDiskResource("/path/to/pem-encoded-ecdsa-key")));
jwt->SetPayload(
    [ iat := GetCurrentDateTime()
    , exp := AddDaysToDate(1, GetCurrentDateTime())
    , loggedInAs := "admin"
    ], CELL[ "loggedInAs" ]);
STRING authvalue := jwt->GetAuthorizationValue();
```

A JSON Web Token is self-contained, so to verify it, the secret or public key to use has to be determined by the contents of
the JWT itself. To verify a JWT, use the `secret_callback` option to return the secret or public key to use for verification.

```harescript
// Get the authorization value from the Authorization HTTP header
STRING authvalue := GetWebHeader("Authorization");
IF (authvalue NOT LIKE "Bearer *")
  THROW NEW Exception("Expected Bearer");
authvalue := Substring(authvalue, 7);

// Verify the authorization value, which returns a verify-only JWT or throws in case of an error
OBJECT jwt;
TRY
{
  jwt := VerifyJSONWebToken(authvalue, [ alg := [ "ES256" ], secret_callback := PTR GetPublicKey ]);
}
CATCH (OBJECT e)
{
  AbortWithHTTPError(403, "JWT verification failed");
}
RECORD payload := jwt->GetPayload(STRING[ "loggedInAs" ]);

STRING FUNCTION GetPublicKey(STRING header_kid)
{
  // Retrieve the public key by the key ID in the JWT header
  RETURN SELECT AS STRING public_key FROM userdatabase WHERE key_id = header_kid;
}
```
