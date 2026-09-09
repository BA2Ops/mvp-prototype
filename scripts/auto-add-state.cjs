#!/usr/bin/env node
/**
 * Auto-add view + state fields to existing JSON test data files.
 * Reads from scripts/data/{primitive}.json, enriches each test with
 * view + state, writes back.
 *
 * Inference rules:
 *   view:
 *     - positive move / execute-op    -> register
 *     - negative move / execute-op    -> error
 *     - skip_n / conditional_skip     -> stack (negative variants -> error)
 *     - execute_intent                -> stack
 *   state:
 *     - stack_before:  parse "stack: [a, b, c]" from preparation
 *     - stack_after:   parse "stack.length).toBe(N)" + "[0].id"
 *     - int_before:    parse "internalStore.set('$r0', ...)" / "$r0 = ..."
 *     - int_after:     parse "expect(internalStore.get(...)).toBe(...)"
 *     - pub_before:    parse "publicStore.set('key', ...)"
 *     - pub_after:     parse "expect(publicStore.get(...))..."
 *     - entry_before:  "pending" by default
 *     - entry_after:   "done" / "running" inferred
 *     - error:         parse "rejects.toThrow(...)" type
 */

const fs = require('fs');
const path = require('path');

function inferView(test, primitive) {
  const isNeg = test.kind === 'negative';
  if (primitive === 'move') return isNeg ? 'error' : 'register';
  if (primitive === 'execute-op') return isNeg ? 'error' : 'register';
  if (primitive === 'execute-intent') return 'stack';
  if (primitive === 'skip-n') return isNeg ? 'error' : 'stack';
  if (primitive === 'conditional-skip') return isNeg ? 'error' : 'stack';
  return 'stack';
}

function parseStackArray(text) {
  // match "stack: [a, b, c]" or "栈: [a, b, c]" or "stack (length=N):): [a, b, c]"
  const m = text.match(/stack[^\[]*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

function parseLength(text) {
  const m = text.match(/stack\.length\)?\.toBe\((\d+)\)/);
  if (m) return parseInt(m[1]);
  const m2 = text.match(/stack\.length\s*===\s*(\d+)/);
  if (m2) return parseInt(m2[1]);
  return null;
}

function parseIntBefore(prep) {
  const result = {};
  // match "$r0 = value" or "internalStore.set('$r0', value)" or "$r0 = 'preserve me'"
  const re1 = /\$r(\w+)\s*=\s*['"]?([^,\n\]]+?)['"]?(?=[,\n\]]|$)/g;
  let m;
  while ((m = re1.exec(prep)) !== null) {
    result['$r' + m[1]] = m[2].trim();
  }
  // match "internalStore.set('$r0', value)"
  const re2 = /internalStore\.set\(['"](\$\w+)['"]\s*,\s*['"]?([^)]+?)['"]?\)/g;
  while ((m = re2.exec(prep)) !== null) {
    result[m[1]] = m[2].trim();
  }
  return Object.keys(result).length ? result : null;
}

function parseIntAfter(asrt, prep) {
  // For negative tests where state should be unchanged, return null
  if (asrt.includes('rejects.toThrow')) return null;
  const result = {};
  // Match "expect(internalStore.get('$r0'))..." with various toBe/toEqual forms
  const re = /internalStore\.get\(['"]?(\$\w+)['"]?\)[^]*?\.toBe(?:Null)?\(\s*['"]?([^)\n]*?)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(asrt)) !== null) {
    result[m[1]] = m[2] === '' ? 'null' : m[2];
  }
  // Match "$r0 === 'value'" (after get)
  const re2 = /\$(\w+)\s*===\s*['"]([^'"]+)['"]/g;
  while ((m = re2.exec(asrt)) !== null) {
    const k = '$r' + m[1];
    if (!result[k]) result[k] = m[2];
  }
  return Object.keys(result).length ? result : null;
}

function parsePubBefore(prep) {
  const result = {};
  const re = /publicStore\.set\(['"]([^'"]+)['"]\s*,\s*['"]?([^)]+?)['"]?\)/g;
  let m;
  while ((m = re.exec(prep)) !== null) {
    result[m[1]] = m[2].trim();
  }
  return Object.keys(result).length ? result : null;
}

function parsePubAfter(asrt) {
  if (asrt.includes('rejects.toThrow')) return null;
  const result = {};
  const re = /publicStore\.get\(['"]([^'"]+)['"]\)[^.]*\.toBe\(['"]?([^)]*?)['"]?\)/g;
  let m;
  while ((m = re.exec(asrt)) !== null) {
    result[m[1]] = m[2] === '' ? 'null' : m[2];
  }
  return Object.keys(result).length ? result : null;
}

function parseError(text) {
  const m = text.match(/rejects\.toThrow\((\w+Error)\)/);
  if (m) return m[1];
  const m2 = text.match(/rejects\.toThrow\(/);
  if (m2) return 'Error';
  return null;
}

function parseEntryAfter(asrt, kind) {
  if (asrt.includes("status === 'done'") || asrt.includes("status==='done'")) return 'done';
  if (asrt.includes("status === 'running'") || asrt.includes("status==='running'")) return 'running';
  if (kind === 'negative' && asrt.includes('rejects.toThrow')) return 'pending (failure path)';
  return 'done';
}

function parseStackAfterByID(asrt) {
  // Try to extract specific stack[0].id assertions
  const m = asrt.match(/stack\[0\]\.id\)?\.toBe\(['"]([^'"]+)['"]\)/);
  if (m) return [m[1]];
  return null;
}

function parseStackAfterByLength(length, prep) {
  if (length === null) return null;
  // If length=1, look for the kept element
  if (length === 1) {
    const m = prep.match(/\[(['"]\w+['"])/);
    if (m) return [m[1].replace(/['"]/g, '')];
  }
  return [`(length=${length})`];
}

function processFile(primitive) {
  const file = path.join(__dirname, 'data', `${primitive}.json`);
  const tests = JSON.parse(fs.readFileSync(file, 'utf8'));
  let enriched = 0;

  for (const t of tests) {
    // Skip if already has view field
    if (t.view && t.state) continue;

    const view = inferView(t, primitive);
    const prep = t.preparation || '';
    const asrt = t.assertion || '';

    const stackBefore = parseStackArray(prep);
    const lengthAfter = parseLength(asrt);
    const stackAfterById = parseStackAfterByID(asrt);
    const stackAfterByLen = parseStackAfterByLength(lengthAfter, prep);
    const stackAfter = stackAfterById || stackAfterByLen;

    const intBefore = parseIntBefore(prep);
    const intAfter = parseIntAfter(asrt, prep);
    const pubBefore = parsePubBefore(prep);
    const pubAfter = parsePubAfter(asrt);
    const entryAfter = parseEntryAfter(asrt, t.kind);
    const error = parseError(asrt);

    t.view = view;
    t.state = {
      stack_before: stackBefore,
      stack_after: stackAfter,
      int_before: intBefore,
      int_after: intAfter,
      pub_before: pubBefore,
      pub_after: pubAfter,
      entry_before: 'pending',
      entry_after: entryAfter,
      error: error
    };
    enriched++;
  }

  fs.writeFileSync(file, JSON.stringify(tests, null, 2), 'utf8');
  console.log(`✓ ${primitive}.json: enriched ${enriched}/${tests.length} tests`);
}

['skip-n', 'conditional-skip', 'execute-op', 'execute-intent'].forEach(processFile);