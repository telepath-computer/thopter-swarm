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
    out_file: '/data/thopter/logs/observer.out.log',
    error_file: '/data/thopter/logs/observer.err.log',
    combine_logs: true,
    merge_logs: true
  }]
};