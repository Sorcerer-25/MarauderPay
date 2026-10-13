import { unzlibSync } from 'fflate';

export interface ParsedTransaction {
  date: string;       // YYYY-MM-DD
  amount: number;     // Gross transaction value
  merchant: string;   // Cleaned merchant/beneficiary name
  paymentMode: 'UPI' | 'Card';
  rawLine: string;
}

/**
 * Converts a base64 string to a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  
  let bufferLength = base64.length * 0.75;
  if (base64[base64.length - 1] === '=') {
    bufferLength--;
    if (base64[base64.length - 2] === '=') {
      bufferLength--;
    }
  }
  
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];
    
    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (p < bufferLength) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

/**
 * Safe, crash-proof Base64 to Binary String decoder for React Native Hermes.
 * Avoids native atob which crashes the engine on malformed padding or line breaks.
 */
export function safeBase64ToBinaryString(base64: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  
  // Clean string: remove any whitespace/newlines/padding
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = cleaned.length;
  
  let binary = '';
  // Process in chunks of 4 characters (24 bits = 3 bytes)
  for (let i = 0; i < len; i += 4) {
    const code1 = lookup[cleaned.charCodeAt(i)] ?? 0;
    const code2 = lookup[cleaned.charCodeAt(i + 1)] ?? 0;
    const code3 = lookup[cleaned.charCodeAt(i + 2)] ?? 0;
    const code4 = lookup[cleaned.charCodeAt(i + 3)] ?? 0;
    
    const bytes1 = (code1 << 2) | (code2 >> 4);
    binary += String.fromCharCode(bytes1);
    
    if (i + 2 < len) {
      const bytes2 = ((code2 & 15) << 4) | (code3 >> 2);
      binary += String.fromCharCode(bytes2);
    }
    if (i + 3 < len) {
      const bytes3 = ((code3 & 3) << 6) | (code4 & 63);
      binary += String.fromCharCode(bytes3);
    }
  }
  
  return binary;
}

/**
 * Custom UTF-8 decoder to convert a byte array to string.
 * This runs consistently in Hermes/JSC without relying on TextDecoder.
 */
function decodeUtf8(bytes: Uint8Array): string {
  // 1. Try native TextDecoder if available (Hermes/JSC support it globally in newer Expo)
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      // fallback
    }
  }

  // 2. High-performance chunked fallback for Hermes/React Native
  const parts: string[] = [];
  const len = bytes.length;
  let chunk = '';
  const chunkSize = 16384; // 16KB chunks

  for (let i = 0; i < len; i++) {
    const b1 = bytes[i];
    if (b1 < 128) {
      chunk += String.fromCharCode(b1);
    } else if (b1 > 191 && b1 < 224) {
      const b2 = bytes[++i];
      chunk += String.fromCharCode(((b1 & 31) << 6) | ((b2 ?? 0) & 63));
    } else if (b1 > 223 && b1 < 240) {
      const b2 = bytes[++i];
      const b3 = bytes[++i];
      chunk += String.fromCharCode(((b1 & 15) << 12) | (((b2 ?? 0) & 63) << 6) | ((b3 ?? 0) & 63));
    } else {
      const b2 = bytes[++i];
      const b3 = bytes[++i];
      const b4 = bytes[++i];
      const val = (((b1 & 7) << 18) | (((b2 ?? 0) & 63) << 12) | (((b3 ?? 0) & 63) << 6) | ((b4 ?? 0) & 63)) - 0x10000;
      chunk += String.fromCharCode(0xD800 + (val >> 10), 0xDC00 + (val & 0x3FF));
    }

    if (chunk.length >= chunkSize) {
      parts.push(chunk);
      chunk = '';
    }
  }

  if (chunk.length > 0) {
    parts.push(chunk);
  }

  return parts.join('');
}

/**
 * Parses relative coordinates and strings from a PDF content stream to extract text lines.
 */
export async function extractTextFromPdf(base64: string): Promise<string[]> {
  console.log("[Diagnostic] extractTextFromPdf called");
  const lines: string[] = [];
  
  // 1. Decode base64 to binary string using our crash-proof JS decoder
  const binaryStr = safeBase64ToBinaryString(base64);
  console.log("[Diagnostic] Decoded base64 using safe JS decoder. Binary length:", binaryStr.length);
  
  let offset = 0;
  const streamPattern = 'stream';
  const endstreamPattern = 'endstream';
  
  let streamCount = 0;
  while (offset < binaryStr.length) {
    const streamIdx = binaryStr.indexOf(streamPattern, offset);
    if (streamIdx === -1) {
      console.log("[Diagnostic] No more stream markers found.");
      break;
    }
    
    const endstreamIdx = binaryStr.indexOf(endstreamPattern, streamIdx + 6);
    if (endstreamIdx === -1) {
      console.log("[Diagnostic] stream found but no endstream found. Breaking.");
      break;
    }
    
    streamCount++;
    console.log(`[Diagnostic] Stream #${streamCount}: streamIdx=${streamIdx}, endstreamIdx=${endstreamIdx}`);
    
    // Check preceding dictionary for /FlateDecode filter
    const dictStart = Math.max(0, streamIdx - 200);
    const dictText = binaryStr.substring(dictStart, streamIdx);
    const isFlate = dictText.includes('/FlateDecode');
    console.log(`[Diagnostic] Stream #${streamCount} isFlate=${isFlate}`);
    
    let startOfStreamData = streamIdx + 6;
    if (binaryStr.charCodeAt(startOfStreamData) === 13) startOfStreamData++; // \r
    if (binaryStr.charCodeAt(startOfStreamData) === 10) startOfStreamData++; // \n
    
    const compressedBinary = binaryStr.substring(startOfStreamData, endstreamIdx);
    
    // Trim trailing line breaks from compressed data
    let endOfData = compressedBinary.length;
    while (endOfData > 0 && (compressedBinary.charCodeAt(endOfData - 1) === 10 || compressedBinary.charCodeAt(endOfData - 1) === 13)) {
      endOfData--;
    }
    const finalCompressedBinary = compressedBinary.substring(0, endOfData);
    console.log(`[Diagnostic] Stream #${streamCount} compressed length=${finalCompressedBinary.length}`);
    
    if (finalCompressedBinary.length > 0) {
      const compressedBytes = new Uint8Array(finalCompressedBinary.length);
      for (let i = 0; i < finalCompressedBinary.length; i++) {
        compressedBytes[i] = finalCompressedBinary.charCodeAt(i);
      }
      
      if (isFlate) {
        try {
          console.log(`[Diagnostic] Decompressing Stream #${streamCount}...`);
          const decompressed = unzlibSync(compressedBytes);
          console.log(`[Diagnostic] Decompressed Stream #${streamCount} success. Bytes: ${decompressed.length}`);
          const decompressedText = decodeUtf8(decompressed);
          console.log(`[Diagnostic] Decoded Stream #${streamCount} text. Length: ${decompressedText.length}`);
          const tokens = tokenizeContentStream(decompressedText);
          console.log(`[Diagnostic] Tokenized Stream #${streamCount}. Tokens: ${tokens.length}`);
          const streamLines = extractTextFromTokens(tokens);
          console.log(`[Diagnostic] Extracted lines from Stream #${streamCount}. Lines: ${streamLines.length}`);
          lines.push(...streamLines);
        } catch (err) {
          console.warn(`[Diagnostic] Stream #${streamCount} decompression failed:`, err);
        }
      } else {
        try {
          console.log(`[Diagnostic] Parsing uncompressed Stream #${streamCount}...`);
          const decompressedText = decodeUtf8(compressedBytes);
          const tokens = tokenizeContentStream(decompressedText);
          const streamLines = extractTextFromTokens(tokens);
          lines.push(...streamLines);
        } catch (err) {
          console.warn(`[Diagnostic] Stream #${streamCount} uncompressed parsing failed:`, err);
        }
      }
    }
    
    offset = endstreamIdx + 9;
  }
  
  console.log(`[Diagnostic] extractTextFromPdf finished. Total lines: ${lines.length}`);
  return lines;
}

function findPattern(data: Uint8Array, pattern: Uint8Array, startOffset = 0): number {
  for (let i = startOffset; i < data.length - pattern.length + 1; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function tokenizeContentStream(stream: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < stream.length) {
    const char = stream[i];
    if (char === ' ' || char === '\r' || char === '\n' || char === '\t') {
      i++;
      continue;
    }
    if (char === '(') {
      let str = '';
      i++;
      let depth = 1;
      while (i < stream.length && depth > 0) {
        const c = stream[i];
        if (c === '\\') {
          const next = stream[i + 1];
          if (next === '(' || next === ')') {
            str += next;
          } else if (next === 'n') {
            str += '\n';
          } else if (next === 'r') {
            str += '\r';
          } else if (next === 't') {
            str += '\t';
          } else {
            str += next;
          }
          i += 2;
        } else if (c === '(') {
          depth++;
          str += c;
          i++;
        } else if (c === ')') {
          depth--;
          if (depth > 0) str += c;
          i++;
        } else {
          str += c;
          i++;
        }
      }
      tokens.push('(' + str + ')');
    } else if (char === '[') {
      tokens.push('[');
      i++;
    } else if (char === ']') {
      tokens.push(']');
      i++;
    } else if (char === '<') {
      if (stream[i + 1] === '<') {
        tokens.push('<<');
        i += 2;
      } else {
        let hex = '';
        i++;
        while (i < stream.length && stream[i] !== '>') {
          hex += stream[i];
          i++;
        }
        i++;
        tokens.push('<' + hex + '>');
      }
    } else if (char === '>') {
      if (stream[i + 1] === '>') {
        tokens.push('>>');
        i += 2;
      } else {
        tokens.push('>');
        i++;
      }
    } else {
      let word = '';
      while (i < stream.length && !'()[]<>\r\n\t '.includes(stream[i])) {
        word += stream[i];
        i++;
      }
      tokens.push(word);
    }
  }
  return tokens;
}

function decodePdfString(str: string): string {
  // Replace octal escapes: \ooo
  let decoded = str.replace(/\\([0-7]{1,3})/g, (match, octal) => {
    const charCode = parseInt(octal, 8);
    return String.fromCharCode(charCode);
  });
  // Replace standard escapes
  decoded = decoded.replace(/\\(.)/g, (match, char) => {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    if (char === 'b') return '\b';
    if (char === 'f') return '\f';
    return char;
  });
  return decoded;
}

function extractTextFromTokens(tokens: string[]): string[] {
  const lines: string[] = [];
  let currentLine = '';
  let i = 0;
  
  let inArray = false;
  let arrayStrings: string[] = [];

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '[') {
      inArray = true;
      arrayStrings = [];
      i++;
    } else if (token === ']') {
      inArray = false;
      i++;
    } else if (token.startsWith('(') && token.endsWith(')')) {
      const text = decodePdfString(token.substring(1, token.length - 1));
      if (inArray) {
        arrayStrings.push(text);
      } else {
        currentLine += text;
      }
      i++;
    } else if (token === 'Tj') {
      i++;
    } else if (token === 'TJ') {
      currentLine += arrayStrings.join('');
      i++;
    } else if (token === 'Td' || token === 'TD') {
      const yStr = tokens[i - 1];
      const y = parseFloat(yStr);
      if (!isNaN(y) && y < -2) {
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
      } else if (!isNaN(y) && y === 0) {
        currentLine += ' ';
      }
      i++;
    } else if (token === 'T*') {
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
      i++;
    } else if (token === "'" || token === '"') {
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
      i++;
    } else {
      i++;
    }
  }
  
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Parses date string in DD/MM/YYYY, DD-MM-YYYY, DD Mon YYYY, or YYYY-MM-DD.
 * Returns ISO normalized format (YYYY-MM-DD) or null if no date matches.
 */
export function parseDate(line: string): string | null {
  // 1. DD/MM/YYYY or DD-MM-YYYY
  const d1 = line.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (d1) {
    const day = d1[1].padStart(2, '0');
    const month = d1[2].padStart(2, '0');
    const year = d1[3];
    return `${year}-${month}-${day}`;
  }
  
  // 2. YYYY-MM-DD
  const d2 = line.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (d2) {
    const year = d2[1];
    const month = d2[2].padStart(2, '0');
    const day = d2[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // 3. DD Mon YYYY
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const d3 = line.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
  if (d3) {
    const day = d3[1].padStart(2, '0');
    const monthStr = d3[2].toLowerCase();
    const month = months[monthStr];
    const year = d3[3];
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

/**
 * Extracts numeric transaction value.
 */
export function parseAmount(line: string): number | null {
  // 1. Look for currency symbol prefix followed by numeric value
  const amtMatch = line.match(/(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)/i);
  if (amtMatch) {
    const val = parseFloat(amtMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) return val;
  }
  
  // 2. Look for decimal amount boundaries (e.g. 150.00 or 1,500.50)
  const decimalMatch = line.match(/\b([\d,]+\.\d{2})\b/);
  if (decimalMatch) {
    const val = parseFloat(decimalMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) return val;
  }
  
  // 3. Fallback: look for integers that do not look like years (outside 2000-2100 range)
  const numMatch = line.match(/\b(\d+)\b/g);
  if (numMatch) {
    for (let j = numMatch.length - 1; j >= 0; j--) {
      const val = parseFloat(numMatch[j]);
      if (!isNaN(val) && val > 0 && (val < 2000 || val > 2100)) {
        return val;
      }
    }
  }
  return null;
}

/**
 * Cleans merchant name to remove transaction numbers or debit markers.
 */
export function cleanMerchant(name: string): string {
  let clean = name.trim();
  // Remove trailing transaction numbers, RR numbers (6+ digits)
  clean = clean.replace(/\b\d{6,}\b/g, '');
  // Remove trailing debit/credit terms
  clean = clean.replace(/\b(dr|cr|debit|credit)\b/gi, '');
  // Remove trailing slashes or hyphens
  clean = clean.replace(/[\/-]+$/g, '');
  // Clean up whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean || 'Unknown Merchant';
}

/**
 * Extracts beneficiary/merchant name.
 */
export function parseMerchant(line: string): string {
  // 1. Look for Paid to / Sent to / To:
  const merchantMatch = line.match(/(?:Paid to|Sent to|To:)\s*([a-zA-Z0-9\s.&'-]+)/i);
  if (merchantMatch) {
    return cleanMerchant(merchantMatch[1]);
  }
  
  // 2. Look for UPI/merchant/id narration
  const upiMatch = line.match(/UPI\/([a-zA-Z0-9\s.&'-]+)/i);
  if (upiMatch) {
    const parts = line.split('/');
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned && !/^\d{8,}$/.test(cleaned) && cleaned.toLowerCase() !== 'upi' && cleaned.toLowerCase() !== 'dr' && cleaned.toLowerCase() !== 'cr') {
        return cleanMerchant(cleaned);
      }
    }
  }
  
  // 3. Fallback: select alphabetical words, excluding keywords
  const ignoredKeywords = ['paid', 'sent', 'to', 'from', 'received', 'upi', 'dr', 'cr', 'rs', 'inr', 'rupees', 'debit', 'credit', 'amount', 'date', 'balance'];
  const words = line.split(/\s+/);
  const merchantWords = words.filter(w => {
    const lw = w.toLowerCase().replace(/[^a-z]/g, '');
    return lw && !ignoredKeywords.includes(lw) && !/^\d+$/.test(w);
  });
  
  if (merchantWords.length > 0) {
    return cleanMerchant(merchantWords.slice(0, 3).join(' '));
  }
  
  return 'Unknown Merchant';
}

/**
 * Processes a full statement string line-by-line to parse valid debit transactions.
 */
export function parseStatementText(text: string): ParsedTransaction[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const transactions: ParsedTransaction[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const date = parseDate(lines[i]);
    if (date) {
      // Look forward up to 5 lines for a transaction amount
      let foundAmount: number | null = null;
      let amountLineIdx = -1;
      
      for (let offset = 0; offset <= 5; offset++) {
        const checkIdx = i + offset;
        if (checkIdx >= lines.length) break;
        
        const amt = parseAmount(lines[checkIdx]);
        if (amt !== null && amt > 0) {
          foundAmount = amt;
          amountLineIdx = checkIdx;
          break;
        }
      }
      
      if (foundAmount !== null && amountLineIdx !== -1) {
        // Collect text segment from date line to amount line (+1 line for indicators)
        const segmentText = lines.slice(i, Math.min(lines.length, amountLineIdx + 2)).join(' ');
        
        const isCredit = /received|refund|credit|salary|\bcr\b/i.test(segmentText);
        if (!isCredit) {
          let merchant = '';
          
          if (amountLineIdx > i) {
            // Find non-date, non-amount lines in between as merchant name
            const merchantLines = lines.slice(i, amountLineIdx + 1)
              .filter(line => !parseDate(line) && parseAmount(line) === null);
            
            if (merchantLines.length > 0) {
              merchant = merchantLines.join(' ');
            } else {
              merchant = lines[i];
            }
          } else {
            merchant = lines[i];
          }
          
          // Clean the merchant name using ignored keywords filtering
          const ignoredKeywords = ['paid', 'sent', 'to', 'from', 'received', 'upi', 'dr', 'cr', 'rs', 'inr', 'rupees', 'debit', 'credit', 'amount', 'date', 'balance'];
          const words = merchant.split(/\s+/);
          const filteredWords = words.filter(w => {
            const lw = w.toLowerCase().replace(/[^a-z]/g, '');
            return lw && !ignoredKeywords.includes(lw) && !/^\d+$/.test(w);
          });
          
          const finalMerchant = cleanMerchant(filteredWords.slice(0, 3).join(' ') || merchant);
          const paymentMode = /upi/i.test(segmentText) ? 'UPI' : 'Card';
          
          transactions.push({
            date,
            amount: foundAmount,
            merchant: finalMerchant,
            paymentMode,
            rawLine: lines.slice(i, amountLineIdx + 1).join(' | ')
          });
        }
        
        // Skip ahead
        i = amountLineIdx + 1;
        continue;
      }
    }
    i++;
  }
  
  return transactions;
}
