FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Terminal normalization variables for proper character rendering
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV LC_CTYPE=en_US.UTF-8
ENV TERM=xterm-256color
ENV COLORTERM=truecolor
ENV FORCE_COLOR=1
ENV NO_UPDATE_NOTIFIER=1
ENV TERMINFO=/usr/share/terminfo

# Base system packages. this takes like 20+ minutes to install so avoid changing this.
RUN apt-get update && apt-get install -y \
    # Locale support
    locales \
    # Terminal support
    ncurses-term \
    ncurses-base \
    # Version control
    git \
    # Build essentials
    build-essential \
    cmake \
    pkg-config \
    # Python ecosystem
    python3 \
    python3-pip \
    python3-venv \
    # Required tools
    curl \
    wget \
    # Additional development tools
    vim \
    nano \
    tmux \
    htop \
    jq \
    ripgrep \
    fd-find \
    # Network tools for debugging
    net-tools \
    iputils-ping \
    # Firewall tools. note: nftables takes 10+ minutes to install?!?
    dnsutils \
    nftables \
    && rm -rf /var/lib/apt/lists/*

# Generate locale properly
RUN locale-gen en_US.UTF-8

# Install Node.js 20 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs

# Install PM2 globally for process management
RUN npm install -g pm2

# Install gotty for web terminal (detect architecture)
# Note: Using sorenisanerd/gotty fork instead of original yudai/gotty because:
# - Original yudai/gotty is no longer maintained (last release 2017)
# - Original lacks ARM64 support (only has gotty_linux_arm.tar.gz for 32-bit ARM)
# - sorenisanerd fork provides proper ARM64 binaries and continued maintenance
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        GOTTY_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ]; then \
        GOTTY_ARCH="arm64"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    wget https://github.com/sorenisanerd/gotty/releases/download/v1.6.0/gotty_v1.6.0_linux_${GOTTY_ARCH}.tar.gz && \
    tar -xzf gotty_v1.6.0_linux_${GOTTY_ARCH}.tar.gz && \
    mv gotty /usr/local/bin/ && \
    chmod +x /usr/local/bin/gotty && \
    rm gotty_v1.6.0_linux_${GOTTY_ARCH}.tar.gz

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# for metadata service
RUN apt-get install -y redis
RUN npm install -g ioredis

# Copy session observer components
COPY scripts/observer.js /usr/local/bin/observer.js
COPY scripts/pm2.config.js /usr/local/bin/pm2.config.js
COPY scripts/start-observer.sh /usr/local/bin/start-observer.sh

# Set permissions for session observer scripts
RUN chmod +x /usr/local/bin/observer.js && \
    chmod +x /usr/local/bin/start-observer.sh

### # Copy firewall setup script  
### COPY scripts/setup-firewall.sh /usr/local/bin/setup-firewall.sh
### RUN chmod +x /usr/local/bin/setup-firewall.sh

# Default tmux configuration with proper terminal support (system-wide)
RUN echo "set -g mouse off" > /etc/tmux.conf && \
    echo "setw -g mode-keys vi" >> /etc/tmux.conf && \
    echo "set -g prefix C-a" >> /etc/tmux.conf && \
    echo "unbind C-b" >> /etc/tmux.conf && \
    echo "bind C-a send-prefix" >> /etc/tmux.conf && \
    echo "set -g default-terminal 'tmux-256color'" >> /etc/tmux.conf && \
    echo "set -ga terminal-overrides ',*256col*:Tc'" >> /etc/tmux.conf

COPY scripts/firewall.js /usr/local/bin/firewall.js
RUN chmod +x /usr/local/bin/firewall.js

# Create init script that transitions from root to thopter user
COPY scripts/thopter-init.sh /usr/local/bin/thopter-init.sh
RUN chmod +x /usr/local/bin/thopter-init.sh

# Default command - run init script as root, which transitions to thopter user
# EXPOSE port matches WEB_TERMINAL_PORT default (can be overridden at runtime)
EXPOSE 7681

# Build argument for current image tag. Changes every time, so, last to
# minimize cache busting.
ARG CURRENT_IMAGE
ENV CURRENT_IMAGE=${CURRENT_IMAGE}

CMD ["/usr/local/bin/thopter-init.sh"]
