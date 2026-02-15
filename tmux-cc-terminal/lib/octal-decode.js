'use strict';

/**
 * Decode tmux CC octal-escaped output data.
 *
 * tmux CC %output lines encode bytes as octal escapes:
 *   \033 -> ESC, \015 -> CR, \012 -> LF, \\ -> backslash
 *
 * @param {string} encoded - The octal-escaped string from tmux CC
 * @returns {string} Decoded string
 */
function octalDecode(encoded) {
  if (!encoded) return '';

  let result = '';
  let i = 0;

  while (i < encoded.length) {
    if (encoded[i] === '\\' && i + 1 < encoded.length) {
      if (encoded[i + 1] === '\\') {
        result += '\\';
        i += 2;
      } else if (
        i + 3 < encoded.length &&
        isOctalDigit(encoded[i + 1]) &&
        isOctalDigit(encoded[i + 2]) &&
        isOctalDigit(encoded[i + 3])
      ) {
        const code = parseInt(encoded.substring(i + 1, i + 4), 8);
        result += String.fromCharCode(code);
        i += 4;
      } else {
        // Not a recognized escape, pass through
        result += encoded[i];
        i++;
      }
    } else {
      result += encoded[i];
      i++;
    }
  }

  return result;
}

function isOctalDigit(c) {
  return c >= '0' && c <= '7';
}

/**
 * Hex-encode a string for tmux send-keys -H.
 *
 * @param {string} data - The raw string to encode
 * @returns {string} Space-separated hex bytes
 */
function hexEncode(data) {
  const bytes = Buffer.from(data, 'utf-8');
  const hexParts = [];
  for (let i = 0; i < bytes.length; i++) {
    hexParts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return hexParts.join(' ');
}

module.exports = { octalDecode, hexEncode };
