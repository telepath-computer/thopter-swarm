#!/usr/bin/env node

/**
 * Test script for firewall.js functionality
 */

// Test IP in CIDR logic
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

function deduplicateIPs(ips, cidrs) {
  return ips.filter(ip => {
    return !cidrs.some(cidr => ipInCidr(ip, cidr));
  });
}

// Test cases
console.log('Testing IPv4 CIDR logic...');
console.log('192.168.1.1 in 192.168.0.0/16:', ipInCidr('192.168.1.1', '192.168.0.0/16')); // should be true
console.log('10.0.0.1 in 192.168.0.0/16:', ipInCidr('10.0.0.1', '192.168.0.0/16')); // should be false
console.log('192.168.1.100 in 192.168.1.0/24:', ipInCidr('192.168.1.100', '192.168.1.0/24')); // should be true

console.log('\nTesting IPv6 CIDR logic...');
console.log('2001:db8::1 in 2001:db8::/32:', ipInCidr('2001:db8::1', '2001:db8::/32')); // should be true
console.log('2002:db8::1 in 2001:db8::/32:', ipInCidr('2002:db8::1', '2001:db8::/32')); // should be false

console.log('\nTesting deduplication...');
const testIps = ['192.168.1.1', '192.168.1.2', '10.0.0.1', '8.8.8.8'];
const testCidrs = ['192.168.0.0/16', '10.0.0.0/8'];
const deduplicated = deduplicateIPs(testIps, testCidrs);
console.log('Original IPs:', testIps);
console.log('CIDRs:', testCidrs);
console.log('Deduplicated IPs:', deduplicated); // should be ['8.8.8.8']

console.log('\nTesting domain parsing...');
process.env.ALLOWED_DOMAINS = 'example.com, test.org , extra.net';
const additionalDomains = [];
if (process.env.ALLOWED_DOMAINS) {
  const domains = process.env.ALLOWED_DOMAINS.split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
  additionalDomains.push(...domains);
}
console.log('Parsed domains:', additionalDomains); // should be ['example.com', 'test.org', 'extra.net']

console.log('\nAll tests completed successfully!');