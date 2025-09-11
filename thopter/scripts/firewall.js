#!/usr/bin/env node

/**
 * Thopter Firewall Script (JavaScript version)
 * 
 * This replaces the bash firewall.sh script with a JavaScript implementation
 * that can properly handle IP range deduplication and provide better error handling.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const dns = require('dns');

// Promisify DNS functions
const dnsLookup = promisify(dns.lookup);
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// Logging functions
const log = {
  info: (msg) => console.error(`[INFO] ${msg}`),
  warn: (msg) => console.error(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Enable debug trace if set
if (process.env.TRACE === '1') {
  process.env.DEBUG = '1';
}

// Check for root privileges
if (process.getuid && process.getuid() !== 0) {
  log.error('Run as root');
  process.exit(1);
}

// Check required binaries
const requiredBinaries = ['nft', 'curl'];
for (const binary of requiredBinaries) {
  try {
    execSync(`command -v ${binary}`, { stdio: 'ignore' });
  } catch (error) {
    log.error(`Required binary not found: ${binary}`);
    process.exit(1);
  }
}

// Check if firewall should be skipped
if (process.env.DANGEROUSLY_SKIP_FIREWALL === 'I_UNDERSTAND') {
  log.warn('DANGEROUSLY_SKIP_FIREWALL=I_UNDERSTAND - Skipping firewall setup');
  log.warn('This thopter has NO EGRESS FILTERING - use only for development/testing');
  process.exit(0);
}

// Try to enable nftables service (ignore errors)
try {
  execSync('systemctl enable nftables', { stdio: 'ignore' });
} catch (error) {
  // Expected to fail in container, ignore
}

// Domain allowlist
const BASELINE_DOMAINS = [
  // GitHub core / API / content
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'codeload.github.com',
  'objects.githubusercontent.com', 'uploads.github.com', 'github-releases.githubusercontent.com',
  'media.githubusercontent.com',
  // GitHub LFS / S3
  'github-cloud.s3.amazonaws.com', 'lfs.github.com',
  // GitHub Packages / GHCR
  'ghcr.io', 'pkg-containers.githubusercontent.com',
  // SSH over 443 (alt) and 22 handled by hostname, port is unrestricted by dst set
  'ssh.github.com',
  // Other baseline dev infra
  'registry.npmjs.org', 'nodejs.org', 'pypi.org', 'files.pythonhosted.org', 'pypi.python.org',
  'api.anthropic.com', 'claude.ai', 'anthropic.com',
  'ubuntu.com', 'security.ubuntu.com', 'archive.ubuntu.com', 'keyserver.ubuntu.com',
  'sentry.io', 'statsig.com', 'update.code.visualstudio.com', 'vscode.dev',
  // TLS OCSP/CRL (avoid handshake stalls)
  'ocsp.digicert.com', 'crl3.digicert.com', 'crl4.digicert.com'
];

// Parse additional domains from environment
const additionalDomains = [];
if (process.env.ALLOWED_DOMAINS) {
  const domains = process.env.ALLOWED_DOMAINS.split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
  additionalDomains.push(...domains);
}

const allDomains = [...BASELINE_DOMAINS, ...additionalDomains];
log.info(`domains=${allDomains.length}`);

/**
 * Resolve a domain to IPv4 and IPv6 addresses with timeout
 */
async function resolveDomain(domain, timeoutMs = 5000) {
  const results = { v4: [], v6: [] };
  
  try {
    // Use Promise.race for timeout
    const v4Promise = dnsResolve4(domain).catch(() => []);
    const v4Timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), timeoutMs));
    
    results.v4 = await Promise.race([v4Promise, v4Timeout]);
  } catch (error) {
    // Timeout or DNS error, continue
  }
  
  try {
    const v6Promise = dnsResolve6(domain).catch(() => []);
    const v6Timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), timeoutMs));
    
    results.v6 = await Promise.race([v6Promise, v6Timeout]);
  } catch (error) {
    // Timeout or DNS error, continue
  }
  
  return results;
}

/**
 * Check if an IP address is contained within a CIDR range
 */
function ipInCidr(ip, cidr) {
  const [network, prefixLength] = cidr.split('/');
  const prefix = parseInt(prefixLength, 10);
  
  if (ip.includes(':')) {
    // IPv6
    return ipv6InCidr(ip, network, prefix);
  } else {
    // IPv4
    return ipv4InCidr(ip, network, prefix);
  }
}

function ipv4InCidr(ip, network, prefix) {
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  
  return (ipInt & mask) === (networkInt & mask);
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function ipv6InCidr(ip, network, prefix) {
  // Simplified IPv6 CIDR check - expand both addresses and compare
  const ipExpanded = expandIPv6(ip);
  const networkExpanded = expandIPv6(network);
  
  if (!ipExpanded || !networkExpanded) return false;
  
  const prefixHexChars = Math.floor(prefix / 4);
  const remainderBits = prefix % 4;
  
  // Compare full hex groups
  const ipPrefix = ipExpanded.substring(0, prefixHexChars);
  const networkPrefix = networkExpanded.substring(0, prefixHexChars);
  
  if (ipPrefix !== networkPrefix) return false;
  
  // Compare remaining bits if any
  if (remainderBits > 0) {
    const ipChar = parseInt(ipExpanded[prefixHexChars] || '0', 16);
    const networkChar = parseInt(networkExpanded[prefixHexChars] || '0', 16);
    const mask = (0xF << (4 - remainderBits)) & 0xF;
    
    return (ipChar & mask) === (networkChar & mask);
  }
  
  return true;
}

function expandIPv6(ip) {
  // Expand IPv6 address to full form
  let expanded = ip;
  
  // Handle :: notation
  if (expanded.includes('::')) {
    const [left, right] = expanded.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missingParts = 8 - leftParts.length - rightParts.length;
    
    const middleParts = Array(missingParts).fill('0000');
    expanded = [...leftParts, ...middleParts, ...rightParts].join(':');
  }
  
  // Pad each part to 4 digits
  const parts = expanded.split(':');
  if (parts.length !== 8) return null;
  
  return parts.map(part => part.padStart(4, '0')).join('').toLowerCase();
}

/**
 * Remove IPs that are already covered by CIDR ranges
 */
function deduplicateIPs(ips, cidrs) {
  return ips.filter(ip => {
    return !cidrs.some(cidr => ipInCidr(ip, cidr));
  });
}

/**
 * Fetch GitHub metadata CIDRs
 */
async function fetchGitHubMetaCidrs() {
  try {
    const response = await fetch('https://api.github.com/meta', {
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const cidrs = new Set();
    
    // Extract CIDRs from api, web, and packages arrays
    ['api', 'web', 'packages'].forEach(key => {
      if (data[key] && Array.isArray(data[key])) {
        data[key].forEach(cidr => {
          if (typeof cidr === 'string' && cidr.trim()) {
            cidrs.add(cidr.trim());
          }
        });
      }
    });
    
    return Array.from(cidrs).sort();
  } catch (error) {
    log.warn(`Failed to fetch https://api.github.com/meta: ${error.message}; continuing without CIDRs`);
    return [];
  }
}

/**
 * Generate nftables configuration
 */
function generateNftConfig(ipv4Addresses, ipv6Addresses, cidrs) {
  const lines = [];
  
  // Create table and chain
  lines.push('add table inet thopter');
  lines.push('add chain inet thopter output { type filter hook output priority 0; policy accept; }');
  lines.push('add set inet thopter allowed_ipv4 { type ipv4_addr; flags interval; }');
  lines.push('add set inet thopter allowed_ipv6 { type ipv6_addr; flags interval; }');
  
  // Add CIDR ranges first
  for (const cidr of cidrs) {
    if (cidr.includes(':')) {
      lines.push(`add element inet thopter allowed_ipv6 { ${cidr} }`);
    } else {
      lines.push(`add element inet thopter allowed_ipv4 { ${cidr} }`);
    }
  }
  
  // Add individual IPs (already deduplicated)
  for (const ip of ipv4Addresses) {
    lines.push(`add element inet thopter allowed_ipv4 { ${ip} }`);
  }
  
  for (const ip of ipv6Addresses) {
    lines.push(`add element inet thopter allowed_ipv6 { ${ip} }`);
  }
  
  // Add output rules
  lines.push('add rule inet thopter output oif lo accept');
  lines.push('add rule inet thopter output ct state established,related accept');
  lines.push('add rule inet thopter output udp dport 53 accept');
  lines.push('add rule inet thopter output tcp dport 53 accept');
  lines.push('add rule inet thopter output ip protocol icmp accept');
  lines.push('add rule inet thopter output ip6 nexthdr icmpv6 accept');
  lines.push('add rule inet thopter output ip daddr { 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } accept');
  lines.push('add rule inet thopter output ip6 daddr { fc00::/7, fe80::/10 } accept');
  lines.push('add rule inet thopter output ip daddr @allowed_ipv4 accept');
  lines.push('add rule inet thopter output ip6 daddr @allowed_ipv6 accept');
  lines.push('add rule inet thopter output log prefix "THOPTER-DROP: " level info');
  lines.push('add rule inet thopter output drop');
  
  return lines;
}

/**
 * Apply nftables configuration
 */
function applyNftConfig(configLines) {
  // Write configuration to temporary file
  const tempFile = `/tmp/nft-apply.${Date.now()}.nft`;
  
  try {
    fs.writeFileSync(tempFile, configLines.join('\n') + '\n');
    
    if (process.env.DEBUG === '1') {
      console.error('--- nft batch ---');
      configLines.forEach(line => console.error(`| ${line}`));
      console.error('-----------------');
    }
    
    // Flush existing ruleset first
    log.info('flush entire nftables ruleset to avoid element conflicts');
    execSync('nft flush ruleset', { stdio: 'ignore' });
    
    // Apply configuration from file
    log.info('apply nft batch configuration');
    execSync(`nft -f ${tempFile}`, { stdio: 'inherit' });
    
  } catch (error) {
    log.error(`Failed to apply nftables configuration: ${error.message}`);
    throw error;
  } finally {
    // Clean up temporary file
    try {
      fs.unlinkSync(tempFile);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Create persistent nftables configuration
 */
function createPersistentConfig() {
  const configContent = `#!/usr/sbin/nft -f
flush ruleset
table inet thopter {
  set allowed_ipv4 {
    type ipv4_addr
    flags interval
  }

  set allowed_ipv6 {
    type ipv6_addr
    flags interval
  }

  chain output {
    type filter hook output priority 0; policy accept
    oif lo accept
    ct state established,related accept

    udp dport 53 accept
    tcp dport 53 accept

    ip  protocol icmp   accept
    ip6 nexthdr  icmpv6 accept

    ip  daddr { 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } accept
    ip6 daddr { fc00::/7, fe80::/10 } accept

    ip  daddr @allowed_ipv4 accept
    ip6 daddr @allowed_ipv6 accept

    log prefix "THOPTER-DROP: " level info
    drop
  }
}
`;

  fs.writeFileSync('/etc/nftables.conf', configContent);
  
  // Validate the persisted file parses
  try {
    execSync('nft -c -f /etc/nftables.conf', { stdio: 'ignore' });
  } catch (error) {
    log.warn('persisted config parse check failed (non-fatal)');
  }
}

/**
 * Test connectivity to key services
 */
function testConnectivity() {
  const tests = [
    { name: 'GitHub', url: 'https://api.github.com' },
    { name: 'NPM', url: 'https://registry.npmjs.org' },
    { name: 'Anthropic', url: 'https://api.anthropic.com' }
  ];
  
  for (const test of tests) {
    try {
      execSync(`curl -s --connect-timeout 5 --max-time 10 ${test.url}`, { stdio: 'ignore' });
      log.info(`${test.name}: OK`);
    } catch (error) {
      log.warn(`${test.name}: FAIL`);
    }
  }
  
  // Test that blocked sites are indeed blocked (should timeout)
  const blockedTests = [
    { name: 'Google timeout', url: 'https://google.com/' },
    { name: 'Craigslist timeout', url: 'https://www.craigslist.org/' }
  ];
  
  for (const test of blockedTests) {
    try {
      execSync(`curl -s --connect-timeout 1 --max-time 2 ${test.url}`, { stdio: 'ignore' });
      log.warn(`${test.name}: FAIL`);
    } catch (error) {
      log.info(`${test.name}: OK`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Resolve all domains to IPs
    const allIpv4 = [];
    const allIpv6 = [];
    
    log.info('Resolving domain names to IP addresses...');
    for (let i = 0; i < allDomains.length; i++) {
      const domain = allDomains[i];
      log.info(`resolve[${i + 1}/${allDomains.length}] ${domain}`);
      
      const { v4, v6 } = await resolveDomain(domain);
      allIpv4.push(...v4);
      allIpv6.push(...v6);
    }
    
    // Remove duplicates
    const uniqueIpv4 = [...new Set(allIpv4)].sort();
    const uniqueIpv6 = [...new Set(allIpv6)].sort();
    
    log.info(`uniq_v4=${uniqueIpv4.length} uniq_v6=${uniqueIpv6.length}`);
    
    // Fetch GitHub metadata CIDRs
    log.info('Fetching GitHub metadata CIDRs...');
    const ghMetaCidrs = await fetchGitHubMetaCidrs();
    log.info(`github_meta_cidrs=${ghMetaCidrs.length} (api+web+packages)`);
    
    // Separate IPv4 and IPv6 CIDRs
    const ipv4Cidrs = ghMetaCidrs.filter(cidr => !cidr.includes(':'));
    const ipv6Cidrs = ghMetaCidrs.filter(cidr => cidr.includes(':'));
    
    // Deduplicate IPs against CIDRs
    log.info('Deduplicating IPs against CIDR ranges...');
    const deduplicatedIpv4 = deduplicateIPs(uniqueIpv4, ipv4Cidrs);
    const deduplicatedIpv6 = deduplicateIPs(uniqueIpv6, ipv6Cidrs);
    
    log.info(`deduplicated_v4=${deduplicatedIpv4.length} deduplicated_v6=${deduplicatedIpv6.length}`);
    
    // Generate and apply nftables configuration
    log.info('Generating nftables configuration...');
    const configLines = generateNftConfig(deduplicatedIpv4, deduplicatedIpv6, ghMetaCidrs);
    
    log.info('Applying nftables configuration...');
    applyNftConfig(configLines);
    
    // Create persistent configuration
    log.info('Creating persistent nftables configuration...');
    createPersistentConfig();
    
    // Test connectivity
    log.info('Testing connectivity...');
    testConnectivity();
    
    log.info(`done (domains=${allDomains.length} v4=${deduplicatedIpv4.length} v6=${deduplicatedIpv6.length} meta_cidrs=${ghMetaCidrs.length})`);
    
  } catch (error) {
    log.error(`Firewall setup failed: ${error.message}`);
    process.exit(1);
  }
}

// Add fetch polyfill for older Node.js versions
if (typeof fetch === 'undefined') {
  global.fetch = async (url, options = {}) => {
    const https = require('https');
    const http = require('http');
    const urlParsed = new URL(url);
    const client = urlParsed.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
      const req = client.request(url, {
        method: options.method || 'GET',
        timeout: options.signal?.timeout || 10000,
        ...options
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data))
          });
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.end();
    });
  };
}

// Run main function
main().catch(error => {
  log.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});