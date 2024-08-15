# typed: false
# frozen_string_literal: true

# This is a dummy formula that is used to install the dependencies for WebHare
class WebhareDeps < Formula
  desc "WebHare dependency descriptions"
  homepage "https://www.webhare.dev/"

  # dummy.tar.gz is an empty tar.gz, but we need to provide brew with *something*
  url "file://" + ENV["HOMEBREW_WEBHARE_CHECKEDOUT_TO"] + "/addons/darwin/dummy.tar.gz"
  version "1"
  sha256 "6d888e48bcda88870b318feee151d42ace8054fb5cd9a10df56786348cc61628"

  depends_on "libtool"
  depends_on "autoconf"
  depends_on "automake"
  depends_on "ccache"
  depends_on "freetype"
  depends_on "fswatch"
  depends_on "giflib"
  depends_on "icu4c"
  depends_on "libmaxminddb"
  depends_on "libpng"
  depends_on "libtiff"
  depends_on "make"
  depends_on "node@" + ENV["HOMEBREW_WEBHARE_NODE_MAJOR"]
  depends_on "openssl"
  depends_on "pixman"
  depends_on "pkg-config"
  depends_on "postgresql@13"
  depends_on "rapidjson"
  depends_on "opensearch"

  def install
    # Note that we can't have the file have any of the usual meta filenames eg. README
    prefix.install "dummy.txt"
  end
end
