/**
 * Build script to transform all files in the 'dist' folder into a single C++ include file.
 * Output is placed in the 'dist_esp32' folder.
 *
 * Data structure:
 *
 *   struct web_file_data {
 *       const char* file_name;
 *       size_t      content_size;
 *       const char* content_type;
 *       const char* content;
 *       const char* content_encoding;
 *   };
 */

import fs from 'fs';
import path from 'path';

const appDir = process.cwd();

const distDir = path.join(appDir, 'dist');
const outDir = path.join(appDir, 'dist-esp32');

// ---- CLI parameter: prefix for global variable names ----------------------
// Usage: node scripts/build-esp32.js [prefix]
// Example: node scripts/build-esp32.js myapp   → generates myapp_files[], etc.
const prefixArg = process.argv[2] || '';
// Add trailing underscore for variable names if not already present
const globalPrefix = prefixArg && !prefixArg.endsWith('_') ? prefixArg + '_' : prefixArg;

// ---- CLI parameter: base path for file URLs ---------------------------------
// Usage: node scripts/build-esp32.js [prefix] [basePath]
// Example: node scripts/build-esp32.js myapp /app   → all file_name values are prefixed with /app
const basePathRaw = process.argv[3] || '';
let basePath = '';
if (basePathRaw) {
  basePath = '/' + basePathRaw.replace(/^\/+|\/+$/g, '');
  basePath = basePath.replace(/\/+/g, '/');
}

// ---- MIME type helper (returns a string constant name) --------------------

const EXT_TO_CONTENT_TYPE = {
  '.html': 'text/html',
  '.htm':  'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.xml':  'application/xml',
  '.txt':  'text/plain',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

/**
 * Return the HTTP content-type for a file path.
 * Special rule: gzip-compressed files always get "text/html".
 */
function getContentType(filePath) {
  if (filePath.endsWith('.gz')) {
    // Rule: use text/html for gzip files
    return 'text/html';
  }
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
}

/**
 * Return the content encoding string for the C++ struct.
 */
function getContentEncoding(filePath) {
  if (filePath.endsWith('.gz')) {
    return '"gzip"';
  }
  return 'nullptr';
}

/**
 * Return the "display" filename – the original path without the trailing .gz
 * e.g. "index.html.gz" → "index.html"
 */
function getDisplayName(filePath) {
  if (filePath.endsWith('.gz')) {
    return filePath.slice(0, -3);
  }
  return filePath;
}

// ---- Collect all files recursively ---------------------------------------

function collectFiles(dir, baseDir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      // Relative path from dist root, always use forward slashes
      let relPath = path.relative(baseDir, fullPath);
      relPath = relPath.split(path.sep).join('/');
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

// ---- Main build logic -----------------------------------------------------

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`Error: dist directory not found at ${distDir}`);
    console.error('Run "npm run build" first.');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(outDir, { recursive: true });

  // Collect all files
  const files = collectFiles(distDir, distDir);
  if (files.length === 0) {
    console.error('Error: No files found in dist directory.');
    process.exit(1);
  }

  // Sort for deterministic output
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Read file contents and build data
  const fileData = [];
  for (const f of files) {
    const buffer = fs.readFileSync(f.fullPath);
    const hexBytes = Array.from(buffer)
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');

    const displayName = getDisplayName(f.relPath);
    const contentType = getContentType(f.relPath);
    const contentEncoding = getContentEncoding(f.relPath);

    fileData.push({
      displayName,
      contentSize: buffer.length,
      contentType,
      hexBytes,
      contentEncoding,
    });
  }

  // ---- Generate C++ output -------------------------------------------------

  let cpp = '';
  cpp += '// Auto-generated file – do not edit manually.\n';
  cpp += `// Generated from ${files.length} file(s) in the dist/ folder.\n`;
  cpp += '//\n';
  cpp += '#pragma once\n';
  cpp += '#include <stddef.h>\n';
  cpp += '#include <stdint.h>\n';
  cpp += '\n';

  // Struct definition with include guard
  cpp += '#ifndef FILE_DATA_STRUCT_DEFINED\n';
  cpp += '#define FILE_DATA_STRUCT_DEFINED\n';
  cpp += '\n';
  cpp += 'struct web_file_data {\n';
  cpp += '    const char*     file_name;\n';
  cpp += '    size_t          content_size;\n';
  cpp += '    const char*     content_type;\n';
  cpp += '    const char*     content_encoding;\n';
  cpp += '    const uint8_t*  content;\n';
  cpp += '};\n';
  cpp += '\n';
  cpp += 'struct web_data {\n';
  cpp += '    const web_file_data* files;\n';
  cpp += '    size_t               count;\n';
  cpp += '};\n';
  cpp += '\n';
  cpp += '#endif // FILE_DATA_STRUCT_DEFINED\n';
  cpp += '\n';
  
  // Per-file content byte arrays
  const prefix = globalPrefix;
  for (let i = 0; i < fileData.length; i++) {
    const fd = fileData[i];
    cpp += `static const uint8_t ${prefix}file_${i}_content[] = {\n`;
    cpp += `    ${fd.hexBytes}\n`;
    cpp += '};\n';
    cpp += '\n';
  }

  // Find the index file (index.html or index.html.gz) for the "/" route
  let rootIndex = -1;
  let rootCountAdded = 0;
  for (let i = 0; i < fileData.length; i++) {
    if (fileData[i].displayName === 'index.html' || fileData[i].displayName === 'index.html.gz') {
      rootIndex = i;
      rootCountAdded = 1;
      break;
    }
  }

  // Master array of web_file_data
  cpp += `static const web_file_data ${prefix}files[] = {\n`;
  // Explicit "/" entry pointing to index.html (or index.html.gz) content
  if (rootIndex >= 0) {
    const fi = fileData[rootIndex];

    // If basePath is specified, add both /basePath and /basePath/ entries
    if (basePath) {
      rootCountAdded = 2;
      cpp += '    {\n';
      cpp += `        "${basePath}",\n`;
      cpp += `        ${fi.contentSize},\n`;
      cpp += `        "${fi.contentType}",\n`;
      cpp += `        ${fi.contentEncoding},\n`;
      cpp += `        ${prefix}file_${rootIndex}_content,\n`;
      cpp += '    },\n';
      cpp += '    {\n';
      cpp += `        "${basePath}/",\n`;
      cpp += `        ${fi.contentSize},\n`;
      cpp += `        "${fi.contentType}",\n`;
      cpp += `        ${fi.contentEncoding},\n`;
      cpp += `        ${prefix}file_${rootIndex}_content,\n`;
      cpp += '    },\n';
    } else {
      rootCountAdded = 1;
      cpp += '    {\n';
      cpp += '        "/",\n';
      cpp += `        ${fi.contentSize},\n`;
      cpp += `        "${fi.contentType}",\n`;
      cpp += `        ${fi.contentEncoding},\n`;
      cpp += `        ${prefix}file_${rootIndex}_content,\n`;
      cpp += '    },\n';
    }
  } 


  for (let i = 0; i < fileData.length; i++) {
    const fd = fileData[i];
    cpp += '    {\n';
    cpp += `        "${basePath}/${fd.displayName}",\n`;
    cpp += `        ${fd.contentSize},\n`;
    cpp += `        "${fd.contentType}",\n`;
    cpp += `        ${fd.contentEncoding},\n`;
    cpp += `        ${prefix}file_${i}_content,\n`;
    cpp += '    },\n';
  }
  cpp += '};\n';
  cpp += '\n';

  // File count convenience constant
  cpp += `static const size_t ${prefix}files_count = ${fileData.length + rootCountAdded};\n`;
  cpp += '\n';
  cpp += `static const web_data ${prefix}web_data = {\n`;
  cpp += `    ${prefix}files,\n`;
  cpp += `    ${prefix}files_count,\n`;
  cpp += '};\n';

  // Write output – filename uses prefix (without trailing underscore)
  const filePrefix = prefixArg.endsWith('_') ? prefixArg.slice(0, -1) : prefixArg;
  const outPath = path.join(outDir, filePrefix ? `${filePrefix}_files.h` : 'dist_files.h');
  fs.writeFileSync(outPath, cpp, 'utf-8');

  console.log(`Generated ${outPath}`);
  console.log(`  ${fileData.length} file(s) embedded`);
  if (globalPrefix) {
    console.log(`  Global prefix: "${globalPrefix}"`);
  }
  if (basePath) {
    console.log(`  Base path: "${basePath}"`);
  }
}

main();