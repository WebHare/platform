# Oracle support/OCI driver

## OCI on OSX

1. Download packages `instantclient-sqlplus-macos.x64-12.1.0.2.0.zip`, `instantclient-sdk-macos.x64-12.1.0.2.0.zip` and `instantclient-basic-macos.x64-12.1.0.2.0.zip` from http://www.oracle.com/technetwork/topics/intel-macsoft-096467.html
2. Place in ~/Library/Caches/Homebrew
3. `brew install InstantClientTap/instantclient/instantclient-basic`
4. `brew install InstantClientTap/instantclient/instantclient-sdk`
5. `brew install InstantClientTap/instantclient/instantclient-sqlplus`
6. Add `DISABLE_OCI=0` to your `~/projects/whbuild/Makefile`
7. `wh mic`
