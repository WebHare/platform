# syntax=docker/dockerfile:experimental
# https://github.com/moby/buildkit/blob/master/frontend/dockerfile/docs/experimental.md

# See https://github.com/phusion/baseimage-docker
FROM       phusion/baseimage:0.11
MAINTAINER WebHare bv <info@webhare.com>

# Environment variables
ENV WEBHARE_IN_DOCKER=1 \
  WEBHARE_UBUNTU=1804 \
  WEBHARE_DATAROOT=/opt/whdata \
  WEBHARE_BUILDDIR=/opt/whbuild/ \
  WEBHARE_DIR=/opt/wh/whtree \
  WEBHARE_CHECKEDOUT_TO=/opt/wh \
  WEBHARE_COMPILECACHE=/opt/wh/whtree/currentinstall/compilecache/ \
  WEBHARE_BABELCACHE=/opt/wh/whtree/currentinstall/babelcache/ \
  WEBHARE_MODULEPATHS=/opt/whmodules \
  WEBHARE_SECUREPORT_BINDIP=0.0.0.0 \
  DEBIAN_FRONTEND=noninteractive \
  APT_KEY_DONT_WARN_ON_DANGEROUS_USAGE=1 \
  PATH=/opt/wh/whtree/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/mssql-tools/bin

# Expose usual WebHare hostingports
EXPOSE 80 443 8000 8443 13684

# Set the run command
CMD [ "/opt/container/launch.sh" ]

# We no longer mark /opt/whdata as a volume so we can do our sanity check whether it really lives on a persistent volume
# VOLUME /opt/whdata

# Base image setup
RUN --mount=type=bind,source=/setup-imagebase.sh,target=/setup-imagebase.sh \
    --mount=type=cache,id=baseimage1,target=/var/cache/apt \
    --mount=type=cache,id=baseimage2,target=/var/lib/apt \
    /bin/bash /setup-imagebase.sh # 20191211

# Install pdfbox
RUN --mount=type=bind,source=/setup-pdfbox.sh,target=/setup-pdfbox.sh \
    --mount=type=cache,id=pdfbox,target=/tmp/downloads \
    /bin/bash /setup-pdfbox.sh

# Install mariaodbc
RUN --mount=type=bind,source=/setup-mariaodbc.sh,target=/setup-mariaodbc.sh \
    --mount=type=cache,id=mariaodbc,target=/tmp/downloads \
    /bin/bash /setup-mariaodbc.sh

# Install elasticsearch
RUN --mount=type=bind,source=/setup-elasticsearch.sh,target=/setup-elasticsearch.sh \
    --mount=type=cache,id=elasticsearch,target=/tmp/downloads \
    /bin/bash /setup-elasticsearch.sh

# Install AWS C++ API
RUN --mount=type=bind,source=/setup-awssdk.sh,target=/setup-awssdk.sh \
    --mount=type=cache,id=aws,target=/tmp/aws/cache/ \
    --mount=type=tmpfs,target=/tmp/aws/build/ \
    /bin/bash /setup-awssdk.sh "1.7.231"

# Add packaging stuff
COPY whtree-npm/ /opt/wh/whtree/

# Let's do the NPM work first, for better caching
# RUN cd /opt/wh/whtree && npm install --no-save && npm prune && npm dedupe && npm cache clear --force && rm -rf ~/.ccache /tmp/*
RUN --mount=type=tmpfs,target=/tmp/,readwrite \
    --mount=type=tmpfs,target=/root/,readwrite \
    --mount=type=cache,id=npmcache,target=/tmp/npmcache \
   cd /opt/wh/whtree && \
   npm_config_cache=/tmp/npmcache npm install --no-save

# Add base source code and stuff needed to compile it
COPY tocompile/ /opt/wh/

# Build those parts.
ARG WHBUILD_OCI
RUN --mount=type=bind,source=/compile-source.sh,target=/compile-source.sh \
    --mount=type=tmpfs,target=/opt/whbuild,readwrite \
    --mount=type=tmpfs,target=/tmp,readwrite \
    --mount=type=cache,id=compile,target=/tmp/compile  \
    --mount=type=secret,id=instantclienturl \
    /bin/bash /compile-source.sh

# Throw in the whtree and addons - note: builds will always stop caching after this step
COPY whtree /opt/wh/whtree

# Postinstall fixups
RUN --mount=type=tmpfs,target=/opt/whdata,readwrite /opt/wh/whtree/modules/system/scripts/internal/fixup_modules.sh

# Add other dropins
ADD dropins /

# Create the shrinkwrap
RUN --mount=type=tmpfs,target=/opt/whdata,readwrite /opt/wh/whtree/modules/system/scripts/internal/create_shrinkwrap.sh

# Add a label with the commit SHA
ARG CI_COMMIT_SHA
ARG CI_PIPELINE_ID
LABEL com.webhare.webhare.git-commit-sha="$CI_COMMIT_SHA" \
      com.webhare.webhare.git-commit-ref="$CI_COMMIT_REF_NAME" \
      com.webhare.webhare.pipelineid="$CI_PIPELINE_ID"
