#!/usr/bin/env bash
# 用法: ./scripts/check-doc-density.sh <file.md>
# 输出: max-cell / bpr / total-kb / sents-per-cell p95
FILE="$1"
[ -z "$FILE" ] && { echo "Usage: $0 <file.md>"; exit 1; }
[ ! -f "$FILE" ] && { echo "File not found: $FILE"; exit 1; }

node -e "
const lines = require('fs').readFileSync('$FILE','utf8').split('\n');
const total = Buffer.byteLength(require('fs').readFileSync('$FILE','utf8'),'utf8');
let cells = 0, maxLen = 0, maxAt = '', sentLens = [];
let isHeader = false;
lines.forEach((line, i) => {
  if (!line.startsWith('|')) return;
  if (line.includes('---')) { isHeader = !isHeader; return; }
  if (isHeader) return;
  line.split('|').forEach((cell, j) => {
    const stripped = cell.replace(/^\s+|\s+\$/g,'').replace(/\*+/g,'').trim();
    if (stripped.length === 0) return;
    cells++;
    if (stripped.length > maxLen) { maxLen = stripped.length; maxAt = 'L'+(i+1)+'c'+j; }
    const sents = stripped.split(/[。.!?！？]/).filter(s => s.trim().length > 0).length;
    sentLens.push(sents);
  });
});
const rows = lines.filter(l => /^\| [0-9]+ \|/.test(l)).length;
const bpr = rows > 0 ? Math.round(total / rows) : 0;
sentLens.sort((a,b)=>b-a);
const p95 = sentLens[Math.floor(sentLens.length * 0.05)] || 0;
console.log('file: $FILE');
console.log('total: ' + total + ' bytes (' + (total/1024).toFixed(1) + ' KB)');
console.log('rows: ' + rows);
console.log('bpr (bytes/row): ' + bpr);
console.log('max-cell: ' + maxLen + ' chars at ' + maxAt);
console.log('sents/cell p95: ' + p95);
console.log('cells analyzed: ' + cells);
"
