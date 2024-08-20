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
  WEBHARE_COMPILECACHE=/opt/wh/whtree/currentinstall/compilecache/ \
  WEBHARE_MODULEPATHS=/opt/whmodules \
  WEBHARE_SECUREPORT_BINDIP=0.0.0.0 \
  WEBHARE_NODE_MAJOR=$WEBHARE_NODE_MAJOR \
  WHBUILD_DOWNLOADCACHE=/tmp/downloads \
  PUPPETEER_CACHE_DIR=/opt/wh/whtree/libexec/puppeteer \
  PATH=/opt/wh/whtree/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN --mount=type=bind,source=/setup-imagebase.sh,target=/setup-imagebase.sh \
    --mount=type=cache,id=baseimage1,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=baseimage2,sharing=locked,target=/var/lib/apt \
    WHBUILD_NODE_URL=$WHBUILD_NODE_URL /bin/bash /setup-imagebase.sh # 2024-08-19

################# STAGE 1 - builder image
FROM       base AS builder

# Environment variables
ENV \
  WEBHARE_BUILDDIR=/opt/whbuild/ \
  WHBUILD_ALLOW=1 \
  WHBUILD_BUILDROOT=/tmp/compile \
  WHBUILD_NODEPS=1 \
  WHBUILD_LTO=1 \
  WHBUILD_WASMLTO=1

# Base image setup
RUN --mount=type=bind,source=/setup-builder.sh,target=/setup-builder.sh \
    --mount=type=cache,id=baseimage1,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=baseimage2,sharing=locked,target=/var/lib/apt \
    /bin/bash /setup-builder.sh # 2024-08-19

# Add base source code and stuff needed to compile it
COPY tocompile/ /opt/wh/

# Build those parts.
RUN --mount=type=tmpfs,target=/opt/whbuild \
    --mount=type=tmpfs,target=/tmp \
    --mount=type=cache,id=compile,target=/tmp/compile  \
    /bin/bash -c ". /opt/emsdk/emsdk_env.sh && /opt/wh/builder/make.sh install"

    ################# STAGE 2 - application image
FROM       base AS appimage

# Expose usual WebHare hostingports
EXPOSE 13684

# Set the run command and an entrypoint that ensures a proper environment even if we go straight to /bin/bash
ENTRYPOINT [ "/opt/container/entrypoint.sh" ]
CMD [ "/opt/container/launch.sh" ]

# We no longer mark /opt/whdata as a volume so we can do our sanity check whether it really lives on a persistent volume
# VOLUME /opt/whdata

ARG WHBUILD_ASSETROOT

# Install pdfbox
RUN --mount=type=bind,source=/setup-pdfbox.sh,target=/setup-pdfbox.sh \
    --mount=type=cache,id=pdfbox,target=/tmp/downloads \
    /bin/bash /setup-pdfbox.sh $WHBUILD_ASSETROOT 2.0.32

# Install TIKA
RUN --mount=type=bind,source=/setup-tika.sh,target=/setup-tika.sh \
    --mount=type=cache,id=pdfbox,target=/tmp/downloads \
    /bin/bash /setup-tika.sh $WHBUILD_ASSETROOT 2.9.2

# Install OpenSearch
RUN --mount=type=bind,source=/setup-opensearch.sh,target=/setup-opensearch.sh \
    --mount=type=cache,id=opensearch,target=/tmp/downloads \
    /bin/bash /setup-opensearch.sh $WHBUILD_ASSETROOT 2.16.0

# Add dropins (service management scripts etc)
ADD dropins /

# Throw in the whtree and addons - note: builds will always stop caching after this step
COPY whtree /opt/wh/whtree

# Add built WebHare (ie 'wh make install' from the parallel build)
RUN --mount=type=bind,from=builder,target=/builder \
   cp -av /builder/opt/wh/whtree/bin /builder/opt/wh/whtree/lib /builder/opt/wh/whtree/fonts /builder/opt/wh/whtree/etc /opt/wh/whtree/

# Finalize WebHare (eg generate files in /opt/wh/) and shrinkwrap it (precompile/pregenerate files)
RUN --mount=type=tmpfs,target=/tmp/ \
    --mount=type=tmpfs,target=/root/ \
    --mount=type=tmpfs,target=/opt/whdata \
    --mount=type=cache,id=npmcache,target=/tmp/npmcache \
   npm_config_cache=/tmp/npmcache /opt/wh/whtree/bin/wh finalize-webhare --shrinkwrap

# Add a label with the commit SHA
ARG CI_COMMIT_SHA
ARG CI_COMMIT_REF_NAME
ARG CI_PIPELINE_ID
ARG WEBHARE_VERSION
LABEL com.webhare.webhare.git-commit-sha="$CI_COMMIT_SHA" \
      com.webhare.webhare.git-commit-ref="$CI_COMMIT_REF_NAME" \
      com.webhare.webhare.pipelineid="$CI_PIPELINE_ID" \
      com.webhare.webhare.version="$WEBHARE_VERSION"
