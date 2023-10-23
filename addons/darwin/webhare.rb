# typed: false
# frozen_string_literal: true

class Webhare < Formula
  desc "WebHare dependency descriptions"
  homepage "https://www.webhare.dev/"
  url "https://www.webhare.dev/"
  version "1"
  sha256 :no_check

  depends_on "autoconf"
  depends_on "automake"
  depends_on "ccache"
  depends_on "freetype"
  depends_on "fswatch"
  depends_on "giflib"
  depends_on "icu4c"
  depends_on "libgit2"
  depends_on "libmaxminddb"
  depends_on "libpng"
  depends_on "libtiff"
  depends_on "node@20"
  depends_on "openssl"
  depends_on "pixman"
  depends_on "pkg-config"
  depends_on "postgresql@13"
  depends_on "rapidjson"
  depends_on "opensearch"
  depends_on "emscripten"
end
