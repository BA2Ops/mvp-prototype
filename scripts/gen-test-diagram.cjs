#!/usr/bin/env node
/**
 * Generic test-diagram generator v2 (view-aware).
 *
 * Usage:
 *   node scripts/gen-test-diagram.cjs \
 *     --primitive skip-n \
 *     --data scripts/data/skip-n.json \
 *     --output docs/mvp/l1-design/02-instructions/skip-n-unit-test-diagram/
 *
 * Each test JSON object supports view-aware fields:
 *   {
 *     "n": 1, "title": "...", ...,
 *     "view": "stack" | "register" | "business" | "error" | "mixed",
 *     "state": {
 *       "stack_before": ["entry1", "entry2"],         // bottom → top, optional
 *       "stack_after":  ["entry1"],                  // optional
 *       "int_before":    {"$r0": "value"},            // optional
 *       "int_after":     {"$r0": "value", "$r1": "value"},
 *       "pub_before":    {"key": "value"},
 *       "pub_after":     {"key": "value"},
 *       "entry_before":  "pending",                   // optional
 *       "entry_after":   "done",                      // optional
 *       "error":         null | "AddressError"        // optional
 *     },
 *     "main_puml_body": "<full PlantUML source>"      // optional, overrides template
 *   }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).reduce((a, x) => {
  const m = x.match(/^--(\w+)=(.+)$/);
  if (m) a[m[1]] = m[2];
  return a;
}, {});

if (!args.primitive || !args.data || !args.output) {
  console.error('Usage: gen-test-diagram.cjs --primitive=<name> --data=<file.json> --output=<dir>');
  process.exit(1);
}

const tests = JSON.parse(fs.readFileSync(args.data, 'utf8'));
const out = path.resolve(args.output);
fs.mkdirSync(out, { recursive: true });

// ============== Helpers = ==============

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function makeOneLiner(text) {
  if (!text) return '';
  // Collapse newlines to spaces, take first line if multiple
  let s = String(text).split('\n')[0].trim();
  // Replace literal \n with space
  s = s.replace(/\\n/g, ' ');
  // Truncate to ~120 chars
  if (s.length > 120) s = s.slice(0, 117) + '...';
  return esc(s);
}

function renderKvMap(map) {
  if (!map || Object.keys(map).length === 0) return '  (empty)';
  return Object.entries(map).map(([k, v]) => `  ${k} = ${v}`).join('\n');
}

function renderStack(stack) {
  if (!stack || stack.length === 0) return '  (empty)';
  // bottom index 0, top index N-1
  return stack.map((entry, i) => {
    if (i === stack.length - 1) return `  [top] ${entry}`;
    return `  [${i}]  ${entry}`;
  }).join('\n');
}

// ============== View-based Main PUML Renderer = ==============

function renderMainPumlStack(t) {
  const s = t.state || {};
  const stackBefore = renderStack(s.stack_before);
  const stackAfter = renderStack(s.stack_after);
  const intBefore = renderKvMap(s.int_before);
  const intAfter = renderKvMap(s.int_after);
  const entryBefore = s.entry_before || '(not tracked)';
  const entryAfter = s.entry_after || '(unchanged)';
  const error = s.error;
  const assertOneLiner = makeOneLiner(t.assertion_one_liner || t.assertion || '');

  return `@startuml
title Test #${t.n}: ${t.title}

object "Before\\nstate.stack" as stack_b {
${stackBefore}
}
object "After\\nstate.stack" as stack_a {
${stackAfter}
}
object "Before\\nstate.internalStore" as int_b {
${intBefore}
}
object "After\\nstate.internalStore" as int_a {
${intAfter}
}

stack_b ..> stack_a : ${esc(t.action || 'execute(entry, state)')}
int_b ..> int_a : (resolve + write)
${error ? `stack_b -[#red]right-> stack_a : ✗ ${error} thrown` : ''}

note right of stack_a
  entry.status: ${entryBefore} → ${entryAfter}
  **验证**
  ${assertOneLiner}
end note

@enduml
`;
}

function renderMainPumlRegister(t) {
  const s = t.state || {};
  const intBefore = renderKvMap(s.int_before);
  const intAfter = renderKvMap(s.int_after);
  const stackBefore = renderStack(s.stack_before);
  const stackAfter = renderStack(s.stack_after);
  const pubBefore = renderKvMap(s.pub_before);
  const pubAfter = renderKvMap(s.pub_after);
  const entryBefore = s.entry_before || 'pending';
  const entryAfter = s.entry_after || 'done';
  const error = s.error;
  const assertOneLiner = makeOneLiner(t.assertion_one_liner || t.assertion || '');

  return `@startuml
title Test #${t.n}: ${t.title}

object "Before\\nstate.internalStore" as int_b {
${intBefore}
}
object "After\\nstate.internalStore" as int_a {
${intAfter}
}
object "Before\\nstate.publicStore" as pub_b {
${pubBefore}
}
object "After\\nstate.publicStore" as pub_a {
${pubAfter}
}

int_b ..> int_a : ${esc(t.action || 'execute(entry, state)')}
pub_b ..> pub_a : (业务数据持久化)
${error ? `int_b -[#red]right-> int_a : ✗ ${error} thrown` : ''}

note right of int_a
  entry.status: ${entryBefore} → ${entryAfter}
  **验证**
  ${assertOneLiner}
end note

@enduml
`;
}

function renderMainPumlError(t) {
  const s = t.state || {};
  const intBefore = renderKvMap(s.int_before);
  const intAfter = renderKvMap(s.int_after);
  const stackBefore = renderStack(s.stack_before);
  const stackAfter = renderStack(s.stack_after);
  const pubBefore = renderKvMap(s.pub_before);
  const pubAfter = renderKvMap(s.pub_after);
  const entryStatus = s.entry_before || 'pending';
  const error = s.error || 'Error thrown';
  const assertOneLiner = makeOneLiner(t.assertion_one_liner || t.assertion || '');

  return `@startuml
title Test #${t.n}: ${t.title}

object "Before" as b {
  state.stack:
${stackBefore}
  state.internalStore:
${intBefore}
  state.publicStore:
${pubBefore}
}

object "After" as a {
  state.stack:
${stackAfter}
  state.internalStore:
${intAfter}
  state.publicStore:
${pubAfter}
}

b -[#red]right-> a : ✗ ${error} thrown
note right of b : entry.status: ${entryStatus}\\n(unchanged — failure path keeps stack)
note right of a
  **验证**
  ${assertOneLiner}
end note

@enduml
`;
}

function renderMainPuml(t) {
  if (t.main_puml_body) return t.main_puml_body;
  const view = t.view || 'stack';
  if (view === 'register') return renderMainPumlRegister(t);
  if (view === 'error') return renderMainPumlError(t);
  return renderMainPumlStack(t);
}

// ============== README Renderer = ==============

function renderReadme(t) {
  const subfigBlock = t.subfig
    ? `\n## 子图：${t.subfig.title}\n\n![${t.subfig.title}](./subfigures/${t.subfig.name})\n`
    : '';

  return `# Test #${t.n}: ${t.title}

> **Source**: \`${t.source_file || ''}\` → describe('${t.describe_block || ''}')

## 目的

${t.purpose}

## 主图

![main](./main.puml)
${subfigBlock}
## 数据准备

\`\`\`ts
${t.preparation}
\`\`\`

## 预期结果与验证

\`\`\`ts
${t.assertion}
\`\`\`

## 设计决策说明

${t.note}

`;
}

// ============== Top-level README Renderer = ==============

function renderTopReadme(tests, primitive) {
  const rows = tests.map((t) => {
    const subLink = t.subfig
      ? `[${t.subfig.name}](./${String(t.n).padStart(2, '0')}-${t.slug}/subfigures/${t.subfig.name})`
      : '—';
    const view = t.view || 'stack';
    return `| ${t.n} | [${String(t.n).padStart(2, '0')}-${t.slug}](./${String(t.n).padStart(2, '0')}-${t.slug}/) | ${t.title} | ${t.kind} | ${view} | ${subLink} |`;
  }).join('\n');

  return `<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# ${primitive} 单元测试图谱（PlantUML 版）

本目录为 ${primitive} 的 ${tests.length} 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

\`\`\`
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
\`\`\`

## ${tests.length} 个测试一览

| # | 目录 | test() 名称 | 类型 | 视图 | 子图 |
|---|------|------------|------|------|------|
${rows}

视图说明：
- **stack**：聚焦 state.stack 前后变化（弹栈/压栈）
- **register**：聚焦 state.internalStore 前后变化（move / execute_op 读写）
- **business**：聚焦 state.publicStore 前后变化（业务数据持久化）
- **error**：聚焦异常抛出 + 状态不变（负向测试）
- **mixed**：多视图同时展示

## 主图设计原则

- **状态前后对比**：每个 Before / After 对象图都列出当前 view 关注的 state 子集
- **action 箭头**：横向箭头标明操作名称 + 参数
- **验证 note**：右侧 note 集中展示 entry.status 变化 + 核心断言
- **错误视图**：红色箭头 + 错误名（AddressError / SkipNError 等）

## 配套文档

- 表格版单元测试清单：[\`../${primitive}-unit-tests.md\`](../${primitive}-unit-tests.md)
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[\`../../../../tests/phase-a/${args.tier || ''}\`](../../../../tests/phase-a/${args.tier || ''})

## 渲染方式

\`\`\`bash
plantuml -recursive ${primitive}-unit-test-diagram/
\`\`\`
`;
}

// ============== Generate = ==============

let generated = 0;
let subfigs = 0;
tests.forEach((t) => {
  const slug = String(t.n).padStart(2, '0') + '-' + t.slug;
  const dir = path.join(out, slug);
  fs.mkdirSync(path.join(dir, 'subfigures'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'main.puml'), renderMainPuml(t));
  fs.writeFileSync(path.join(dir, 'README.md'), renderReadme(t));
  generated += 2;

  if (t.subfig) {
    fs.writeFileSync(path.join(dir, 'subfigures', t.subfig.name), t.subfig.body);
    generated++;
    subfigs++;
  }
});

fs.writeFileSync(path.join(out, 'README.md'), renderTopReadme(tests, args.primitive));

console.log(`✓ generated ${generated} files for ${tests.length} tests (${subfigs} subfigs)`);
console.log(`  output: ${out}`);