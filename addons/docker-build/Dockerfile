# WARNING: podman builds are unsafe (stale layers) until https://github.com/containers/buildah/issues/5400 is fixed
# Updating the #date/timestamp comment on a command can help to force a rebuild

################# STAGE 0 - base image. shared between builder and runner
FROM       ubuntu:20.04 AS base
MAINTAINER WebHare bv <info@webhare.com>

ARG WEBHARE_NODE_MAJOR # Depend on this setting to let builder.sh download the proper node
ARG WHBUILD_NODE_URL

# Environment variables
ENV LC_ALL=C \
  WEBHARE_BASEPORT=13679 \
  WEBHARE_IN_DOCKER=1 \
  WEBHARE_DATAROOT=/opt/whdata/ \
  WEBHARE_DIR=/opt/wh/whtree \
  WEBHARE_CHECKEDOUT_TO=/opt/wh \
  WEBHARE_HSBUILDCACHE=/opt/wh/whtree/currentinstall/cache.harescript/13679/ \
  WEBHARE_TSBUILDCACHE=/opt/wh/whtree/currentinstall/cache.typescript/ \
  WEBHARE_MODULEPATHS=/opt/whmodules \
  WEBHARE_SECUREPORT_BINDIP=0.0.0.0 \
  WEBHARE_NODE_MAJOR=$WEBHARE_NODE_MAJOR \
  WEBHARE_NODE_BINARY=node \
  WHBUILD_DOWNLOADCACHE=/tmp/downloads \
  PUPPETEER_CACHE_DIR=/opt/wh/whtree/libexec/puppeteer \
  PATH=/opt/wh/whtree/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN --mount=type=bind,source=addons/docker-build/setup-imagebase.sh,target=/setup-imagebase.sh \
    --mount=type=cache,id=baseimage1,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=baseimage2,sharing=locked,target=/var/lib/apt \
    WHBUILD_NODE_URL=$WHBUILD_NODE_URL /bin/bash /setup-imagebase.sh # 2024-10-31

################# STAGE 1 - builder image
FROM       base AS builder

ARG WHBUILD_EMSCRIPTEN_VERSION

# Environment variables
ENV \
  WEBHARE_BUILDDIR=/opt/whbuild/ \
  WHBUILD_ALLOW=1 \
  WHBUILD_BUILDROOT=/tmp/compile \
  WHBUILD_NODEPS=1 \
  WHBUILD_LTO=1 \
  WHBUILD_WASMLTO=1 \
  WHBUILD_EMSCRIPTEN_VERSION=$WHBUILD_EMSCRIPTEN_VERSION

ARG WHBUILD_ASSETROOT

# Add vendor stuff (needed for emsdk)
COPY vendor/ /opt/wh/vendor/

# Base image setup
RUN --mount=type=bind,source=addons/docker-build/setup-builder.sh,target=/setup-builder.sh \
    --mount=type=cache,id=builderdownloads,target=/tmp/downloads \
    --mount=type=cache,id=baseimage1,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=baseimage2,sharing=locked,target=/var/lib/apt \
    /bin/bash /setup-builder.sh "$WHBUILD_ASSETROOT" # 2024-08-19

# Add base source code and stuff needed to compile it
# fonts are needed for drawlib tests
# lib/make-functions.sh stores functions shared between the build and runtime process so we need it earlier.

# Specifically binding the folders we copy or we'll invalidate too often. perhaps there should be less build relevant directories :-)
RUN --mount=type=bind,source=/ap,target=/mnt/ap \
    --mount=type=bind,source=/blex,target=/mnt/blex \
    --mount=type=bind,source=/builder,target=/mnt/builder \
    --mount=type=bind,source=/drawlib,target=/mnt/drawlib \
    --mount=type=bind,source=/harescript,target=/mnt/harescript \
    --mount=type=bind,source=/parsers,target=/mnt/parsers \
    --mount=type=bind,source=/whtree/fonts,target=/mnt/whtree/fonts \
    --mount=type=bind,source=/whtree/etc,target=/mnt/whtree/etc \
    --mount=type=bind,source=/whtree/lib,target=/mnt/whtree/lib \
    mkdir -p /opt/wh/whtree/ && \
    cp -a /mnt/ap /mnt/blex /mnt/builder /mnt/drawlib /mnt/harescript /mnt/parsers /opt/wh/ && \
    cp -a /mnt/whtree/fonts /mnt/whtree/lib /mnt/whtree/etc /opt/wh/whtree/

# Build those parts.
RUN --mount=type=tmpfs,target=/opt/whbuild \
    --mount=type=tmpfs,target=/tmp \
    --mount=type=cache,id=compile,target=/tmp/compile  \
    /bin/bash -c ". /opt/wh/vendor/emsdk/emsdk_env.sh && /opt/wh/builder/make.sh install"

################# STAGE 2 - application image
FROM       base AS appimage

# Expose usual WebHare hostingports
EXPOSE 13684

ARG WHBUILD_ASSETROOT

# Install pdfbox
RUN --mount=type=bind,source=addons/docker-build/setup-pdfbox.sh,target=/setup-pdfbox.sh \
    --mount=type=cache,id=pdfbox,target=/tmp/downloads \
    /bin/bash /setup-pdfbox.sh "$WHBUILD_ASSETROOT" 2.0.32  # 2024-11-01

# Install TIKA
RUN --mount=type=bind,source=addons/docker-build/setup-tika.sh,target=/setup-tika.sh \
    --mount=type=cache,id=tika,target=/tmp/downloads \
    /bin/bash /setup-tika.sh "$WHBUILD_ASSETROOT" 2.9.2

# Install OpenSearch
RUN --mount=type=bind,source=addons/docker-build/setup-opensearch.sh,target=/setup-opensearch.sh \
    --mount=type=cache,id=opensearch,target=/tmp/downloads \
    /bin/bash /setup-opensearch.sh "$WHBUILD_ASSETROOT" 2.16.0

## Install Chrome
#RUN --mount=type=bind,source=addons/docker-build/setup-puppeteer.sh,target=/setup-puppeteer.sh \
#    --mount=type=tmpfs,target=/tmp \
#    npm_config_cache=/tmp/npmcache \
#    /bin/bash /setup-puppeteer.sh  # 2024-07-02 - TODO if we can get the chrome version number online somewhere, could make it a BUILDARG ?

# Add dropins (service management scripts etc)
ADD addons/docker-build/dropins /

# Throw in the whtree and addons - note: builds will always stop caching after this step
# But one does not simply 'copy all files from the source to the target'.
# Force all timestamps to second precisions, docker layers drop milliseconds during compression but they also seem
# to reuse the FS between buildstemps, causing finalize-webhare to otherwise include millisecond precision timestamps (visible in libdumper)
# while losing these on the filesystem causing unneeded recompilation
# using a reference 'file' as setting and the *using* an envvar inside a docker command line is tricky
RUN --mount=type=bind,source=whtree,target=/whtree/ \
    if [ -d /opt/wh/whtree/jssdk ] || [ -d /opt/wh/whtree/modules ]; then echo "jssdk/modules already have content! touching will cause layer bloat"; ls -lR /opt/wh/whtree ; exit 201;  fi ; \
    cp -a /whtree /opt/wh/ && \
    touch -t $(date +%Y%m%d%H%M.%S) /opt/wh/whtree && \
    find /opt/wh/whtree/jssdk /opt/wh/whtree/modules -type f -print0  | xargs -0 -n250 touch -r /opt/wh/whtree

# Add built WebHare (ie 'wh make install' from the parallel build)
RUN --mount=type=bind,from=builder,target=/builder \
   cp -av /builder/opt/wh/whtree/bin /builder/opt/wh/whtree/lib /builder/opt/wh/whtree/fonts /builder/opt/wh/whtree/etc /opt/wh/whtree/

# Finalize WebHare (eg generate files in /opt/wh/)
RUN --mount=type=tmpfs,target=/tmp/ \
    --mount=type=tmpfs,target=/root/ \
    --mount=type=tmpfs,target=/opt/whdata \
    --mount=type=cache,id=npmcache,target=/tmp/npmcache \
   npm_config_cache=/tmp/npmcache /opt/wh/whtree/bin/wh finalize-webhare

# Set the run command and an entrypoint that ensures a proper environment even if we go straight to /bin/bash
# Last step so we can enter intermediate containers and debug
ENTRYPOINT [ "/opt/container/entrypoint.sh" ]
CMD [ "/opt/container/launch.sh" ]

# Add a label with the commit SHA
ARG CI_COMMIT_SHA
ARG CI_COMMIT_REF_NAME
ARG CI_PIPELINE_ID
ARG WEBHARE_VERSION
LABEL com.webhare.webhare.git-commit-sha="$CI_COMMIT_SHA" \
      com.webhare.webhare.git-commit-ref="$CI_COMMIT_REF_NAME" \
      com.webhare.webhare.pipelineid="$CI_PIPELINE_ID" \
      com.webhare.webhare.version="$WEBHARE_VERSION"
