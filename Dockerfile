# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ARG USER_UID=1000
ARG USER_GID=1000

ENV DEBIAN_FRONTEND=noninteractive

# System deps: Node.js 24, Xvfb, Mesa OpenGL (required by maplibre-gl-native),
# and build tools for native node addons (sharp, maplibre).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    # X virtual framebuffer + OpenGL / EGL
    xvfb \
    x11-utils \
    libgl1 \
    libgl1-mesa-dri \
    libglx-mesa0 \
    libopengl0 \
    libegl1 \
    libgles2 \
    mesa-utils \
    # maplibre-gl-native runtime deps
    libuv1 \
    # native addon build toolchain
    build-essential \
    python3 \
    # sharp runtime deps
    libvips-dev \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 24.x via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user whose UID/GID matches the host user.
# Ubuntu 24.04 ships with a "ubuntu" user (uid/gid 1000), so we rename it
# if the requested IDs already exist rather than adding a duplicate.
RUN groupmod -n appuser "$(getent group "${USER_GID}" | cut -d: -f1)" 2>/dev/null \
    || groupadd --gid "${USER_GID}" appuser \
  && usermod -l appuser -d /home/appuser -m \
       "$(getent passwd "${USER_UID}" | cut -d: -f1)" 2>/dev/null \
    || useradd --uid "${USER_UID}" --gid "${USER_GID}" \
               --shell /bin/bash --create-home appuser

# Pre-create the X11 socket directory with sticky bit so Xvfb can use it
# as a non-root user (same as /tmp on a normal Linux host).
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

WORKDIR /app

# Install dependencies as root (native addon build may need it),
# then hand ownership to appuser using numeric IDs (name may differ per image).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && chown -R "${USER_UID}:${USER_GID}" /app

COPY --chown="${USER_UID}:${USER_GID}" . .
COPY --chown="${USER_UID}:${USER_GID}" entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER appuser

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
