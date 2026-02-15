// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.test.js',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  retries: 0,
  workers: 1,
  reporter: 'list',
});
