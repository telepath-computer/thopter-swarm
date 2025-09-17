module.exports = {
  apps: [{
    name: 'session-observer',
    script: '/usr/local/bin/observer.js',
    cwd: '/data/thopter',
    user: 'thopter',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    out_file: '/data/logs/observer.out.log',
    error_file: '/data/logs/observer.err.log',
    combine_logs: true,
    merge_logs: true
  }, {
    name: 'claude-log-generator',
    script: 'bash',
    args: '-c "source /uv/env && node /usr/local/bin/claude-log-generator.js"',
    cwd: '/data/thopter',
    user: 'thopter',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    out_file: '/data/logs/claude-log.out.log',
    error_file: '/data/logs/claude-log.err.log',
    combine_logs: true,
    merge_logs: true
  }, {
    name: 'claude-log-webserver',
    script: 'python3',
    args: '-m http.server --bind :: 7791',
    cwd: '/data/thopter/.claude/projects',
    user: 'thopter',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    out_file: '/data/logs/webserver.out.log',
    error_file: '/data/logs/webserver.err.log',
    combine_logs: true,
    merge_logs: true
  }, {
    name: 'git-proxy-mcp',
    script: '/usr/local/bin/git-proxy-mcp.js',
    cwd: '/root',
    user: 'root',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    env: {
      NODE_ENV: 'production',
      WORK_BRANCH: process.env.WORK_BRANCH,
      IS_GOLDEN_CLAUDE: process.env.IS_GOLDEN_CLAUDE
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    out_file: '/data/logs/git-proxy.out.log',
    error_file: '/data/logs/git-proxy.err.log',
    combine_logs: true,
    merge_logs: true
  }]
};