FROM ubuntu

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV LC_CTYPE=en_US.UTF-8
ENV TERM=xterm-256color
ENV COLORTERM=truecolor
ENV FORCE_COLOR=1
ENV NO_UPDATE_NOTIFIER=1
ENV TERMINFO=/usr/share/terminfo

RUN apt-get update && apt-get install -y \
    locales \
    curl \
    wget \
    vim \
    nano \
    tmux \
    htop \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# for metadata service
RUN apt-get install -y redis

# Install fly CLI
RUN curl -L https://fly.io/install.sh | sh
ENV PATH="/root/.fly/bin:$PATH"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev deps for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies to keep image smaller
RUN npm ci --only=production && npm cache clean --force

ARG HUB_PORT=8080
ARG HUB_STATUS_PORT=8081

# Expose ports
EXPOSE ${HUB_PORT}
EXPOSE ${HUB_STATUS_PORT}

# Start the server
CMD ["npm", "start"]
