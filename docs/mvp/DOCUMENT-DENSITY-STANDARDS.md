<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# 文档信息密度全局标准（项目级镜像）

> **本文件为 `~/.pi/DOCUMENT-DENSITY-STANDARDS.md` 的项目级镜像**。两者内容应保持一致——若本文件滞后，请以 `~/.pi/` 全局版本为权威源。

> **本标准适用于本仓库所有 markdown 文档**（含 `docs/mvp/`、`docs/dev-log/`、`docs/mvp/l1-design/` 等子目录）。一旦发现文档密度偏离对应等级的可量化阈值，必须立即重写而非"修补"。

> **背景**：本标准从本仓库 `docs/mvp/l1-design/02-instructions/*.md` 五篇姊妹文档（move / skip_n / conditional_skip / execute_op / execute_intent 各自的 `-unit-tests.md`）的"踩坑→重写"过程中沉淀。同一种"表格 cell 注水→markdown 结构坍塌"故障在过去多个回合内反复出现，**根因始终是缺少可量化的密度阈值**——只凭"简洁/详细"等定性形容词无法在生成阶段拦截。第一次 `execute-op-unit-tests.md` 产出 186KB 坍塌版（max cell 10098 字符）即典型反例。

---

## §一 量化维度（5 个独立指标）

| 指标 | 缩写 | 测量方式 | 防的是什么 |
|------|------|----------|-----------|
| **单 cell 最大字符数** | `max-cell` | markdown 表格内任一单元格去除前后空白与加粗后的字符数 | 表格 cell 注水导致 markdown 结构坍塌 |
| **每 cell 句子数** | `sents/cell` | 单个 cell 内 `.`/`。`/`!`/`?`/`!`/`?` 分隔的句子片段数 | 单 cell 内元描述冗余、自指性段落 |
| **bytes per row** | `bpr` | 文件总字节数 ÷ numbered table rows 总数（仅按 `^\| [0-9]+ \|` 行） | 整体行密度偏离基线 |
| **章节前缀引用长度** | `preface` | 每个 `###` describe 块前的 `> ...` 块引用字符数（每段） | 单 describe 块前缀引言膨胀为整篇文档的主要内容 |
| **单文档总字节数** | `total-kb` | 整个 .md 文件字节数 | 文件整体偏离对应等级上限 |

---

## §二 五个密度等级

### 等级 1 — 紧凑 (Compact) ：信号密度最高档

| 维度 | 阈值 |
|------|------|
| `max-cell` | **≤ 80** 字符 |
| `sents/cell` | **≤ 2** 句 |
| `bpr` | **200 – 350** bytes/row |
| `preface` | **≤ 50** 字符 / 段 |
| `total-kb` | **≤ 10 KB** |

**适用场景**：单元测试清单、API 速查表、表格密集型对照表、布尔矩阵。

**本仓库典型实例**：`docs/mvp/l1-design/02-instructions/skip-n-unit-tests.md`（7,773 字节 / 22 行 = 353 bpr）。

---

### 等级 2 — 标准 (Standard) ：信息密度推荐档（默认目标）

| 维度 | 阈值 |
|------|------|
| `max-cell` | **≤ 150** 字符 |
| `sents/cell` | **≤ 3** 句 |
| `bpr` | **350 – 550** bytes/row |
| `preface` | **≤ 100** 字符 / 段 |
| `total-kb` | **≤ 15 KB** |

**适用场景**：API 参考文档、指令规范、ADR、README、单元测试清单（默认档）。

**本仓库典型实例**：`docs/mvp/l1-design/02-instructions/move-unit-tests.md`（8,266 字节 / 16 行 = 516 bpr）。

---

### 等级 3 — 详细 (Detailed) ：带解释的设计文档

| 维度 | 阈值 |
|------|------|
| `max-cell` | **≤ 300** 字符 |
| `sents/cell` | **≤ 5** 句 |
| `bpr` | **550 – 900** bytes/row |
| `preface` | **≤ 300** 字符 / 段 |
| `total-kb` | **≤ 30 KB** |

**适用场景**：架构决策记录（深层版）、设计理念解释、需求规格说明书、设计反馈报告。

**本仓库典型实例**：`docs/mvp/19-register-file-core.md`、`docs/dev-log/2026-08-20-design-feedback-major-rewrite.md`。

---

### 等级 4 — 深度 (Deep-dive) ：教学 / 剖析型

| 维度 | 阈值 |
|------|------|
| `max-cell` | **≤ 600** 字符 |
| `sents/cell` | **≤ 10** 句 |
| `bpr` | **900 – 1500** bytes/row |
| `preface` | **≤ 800** 字符 / 段 |
| `total-kb` | **≤ 80 KB** |

**适用场景**：教程、新人 onboarding 手册、复杂系统剖析、含完整代码示例的实现指南。

**典型实例**：pi 自身文档 `compaction.md`、`extensions.md`、`custom-provider.md`。

---

### 禁止区 (Forbidden) ："坍塌红线"

| 维度 | 阈值 | 后果 |
|------|------|------|
| `max-cell` | **> 1000** 字符 | 表格结构必然坍塌 |
| `bpr` | **> 1500** bytes/row | 文档已偏离深度等级上限 → 立即降到等级 4 重写 |
| `total-kb` | **> 100 KB** | 单一文档不应承载如此多内容 → 拆分为多个等级 ≤3 的子文档 |

**触发任一指标即视为"文档坍塌"**，必须按 §三 流程立即重写而非"修补"。

**历史教训**：本仓库第一次 `execute-op-unit-tests.md`（186 KB / max cell 10098 字符）触发坍塌，被识别为注水老路的复发。

---

## §三 密度审计流程（编写 / 重写 / 提交前必走）

### 3.1 编写新文档时

1. **先定级**：根据 §二 选定目标等级（默认 Standard）
2. **明确测量点**：在文档开头加 `<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->` 声明
3. **写完后跑量化检查**（见 §四 脚本）
4. **任一指标超标 → 立即降级或重写**——不能"接近就放过"

### 3.2 重写已有文档时

1. **先测量现状**：跑 §四 脚本，输出当前 `max-cell / bpr / total-kb`
2. **对照目标等级**：判定当前属于哪个等级（或触发禁止区）
3. **若触发禁止区 → 整篇重写**（不要修补，因为结构本身已坏）
4. **若属于高级别（如 Detailed）而目标是 Standard → 整篇重写**（不要试图保留段落）
5. **若属于同级别但局部超标 → 局部紧缩至阈值内**

### 3.3 提交前自查清单

- [ ] `max-cell` 在选定等级的阈值内
- [ ] 全文无 `max-cell` > 1000 字符的 cell
- [ ] `bpr` 在选定等级区间内
- [ ] 全文总字节数 < 选定等级上限
- [ ] 章节前缀引用全部 ≤ `preface` 阈值
- [ ] 文末无冗余"对账说明"长段（除非确有必要且 ≤200 字符）

### 3.4 超标时的可选解决方案（按侵入度由低到高）

> **决策原则**：先用侵入度最低的方案；只有当结构本身已经坏掉（如触发禁止区红线），才升级到侵入度更高的方案。**永远不要"修补"已触发禁止区的文档——必须重写**。

#### 方案 A：单元格内容精简（侵入度最低）

**触发条件**：个别 `max-cell` 略超阈值（如 80→100），整体结构完好。

**操作手段**：

| 手段 | 反例 → 正例 |
|------|------------|
| 删除修饰性副词 / 连接词 | "**刻意**没去穷举" → "没去穷举" |
| 长句拆短句 | "a 而非 b 这点决定了 c 因此 d" → "a 而非 b；这决定了 c，因此 d" |
| 元描述移到章节前缀 | cell 内"这是为了拦 X 类 bug" → 提到 `>` 引用 |
| 代码引用替代文字描述 | "调用栈的弹出方法" → `` `state.stack.pop()` `` |
| 删除同义反复 / 中英并列 | "compact + 紧凑型" → "紧凑型"；"default + 默认" → "默认" |

#### 方案 B：章节前缀块引用转移（侵入度低）

**触发条件**：每行 `max-cell` 达标，但 describe 块前的 `> ...` 引言过长（`preface` 超阈值）。

**操作手段**：

- 跨多 cell 适用的"通用背景说明" → 提到 `>` 引用，统一约束一次
- 单 cell 适用的局部细节 → 留在 cell 里
- 严格控制 `>` 引用 ≤ `preface` 阈值（Standard ≤100 字符/段）
- 必要时把 `>` 引用再分层：块级 `>` + 行内 `>`

#### 方案 C：表格拆分（侵入度中）

**触发条件**：`bpr` 偏高（如 600+），但 `max-cell` 仍合规。

**三种拆分方向**：

| 方向 | 操作 | 适用 |
|------|------|------|
| **横向拆分** | 按 describe block 拆成多个小表 | 测试清单（每组用例独立成表） |
| **纵向拆分** | 把"目的"列剥离成 describe 块前缀 | API 参考（共用背景不重复写） |
| **字段拆分** | 长字段（≥80 字符）拆成 key + value 两行 | 含完整代码示例的描述 |

#### 方案 D：文档拆分（侵入度高）

**触发条件**：单文档超 Standard 上限（>15 KB），但内容无法再压缩。

**操作手段**：

- 拆分为多篇**姊妹文档**（如本仓库把 5 个 primitive 各自的 unit-tests 拆成 5 篇 + 1 篇 README 索引）
- 每篇独立成文、独立评估密度等级
- README 索引只放"对应测试文件 → 文档"映射表（与姊妹文档同密度）
- 各篇之间用统一的章节命名约定以保持可对比性

#### 方案 E：结构重组（侵入度最高）

**触发条件**：密度问题源于文档组织结构本身（如强行用表格表达本应是 list 的内容）。

**操作手段**：

| 原结构 | 新结构 | 适用场景 |
|--------|--------|----------|
| 大表格 | 多层级 list | 字段间有从属关系而非平行 |
| 普通 list | checklist（`- [ ]`） | 任务清单 / 自查项 |
| 多段正文 | 单段（删过渡句） | 短解释 / FAQ |
| 长篇叙述 | ADR 三段式（背景/决策/后果） | 设计决策记录 |
| 嵌套 list | 扁平 list + 前缀编号 | 层级 ≥3 时 |

#### 选择决策树

```
指标超标？
├── max-cell > 1000 或 bpr > 1500 或 total-kb > 100
│   └── 🔴 禁止区触发 → 整篇重写（不要修补）
│
├── max-cell 略超（如 ≤ 200）且仅个别 cell
│   └── 方案 A：单元格内容精简
│
├── preface 超限（块引用过长）
│   └── 方案 B：块引用转移
│
├── bpr 偏高但 max-cell 仍合规
│   └── 方案 C：表格拆分
│
└── total-kb 超上限且内容不可压缩
    └── 方案 D：文档拆分（多篇姊妹文档）
        │
        └── 拆分后单篇仍超限 → 方案 E：结构重组
```

---

## §四 量化检查脚本

把以下脚本保存到 `scripts/check-doc-density.sh`：

```bash
#!/usr/bin/env bash
# 用法: ./scripts/check-doc-density.sh <file.md>
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
"
```

跨文件批量审计（本仓库所有 `*.md`）：

```bash
for f in $(find docs -name "*.md" -type f); do
  echo "=== $f ==="
  ./scripts/check-doc-density.sh "$f"
done
```

---

## §五 等级判定速查表

| 指标超限 / 满足 | 判定 |
|------|------|
| `max-cell > 1000` 或 `bpr > 1500` 或 `total-kb > 100` | 🔴 **坍塌**，立即重写 |
| `max-cell ≤ 600` 且 `bpr ∈ [900, 1500]` 且 `total-kb ≤ 80` | 等级 4（深度） |
| `max-cell ≤ 300` 且 `bpr ∈ [550, 900]` 且 `total-kb ≤ 30` | 等级 3（详细） |
| `max-cell ≤ 150` 且 `bpr ∈ [350, 550]` 且 `total-kb ≤ 15` | 等级 2（标准）★ 默认 |
| `max-cell ≤ 80` 且 `bpr ∈ [200, 350]` 且 `total-kb ≤ 10` | 等级 1（紧凑） |

> **判定规则**：5 个指标必须同时满足对应等级的阈值，才能定为该等级；任一指标溢出到下一区间则升级到更高级别（除非触发禁止区则直接坍塌）。

---

## §六 与本标准的"合约"承诺

任何文档编写 / 重写任务开始前，应在文档开头加一行密度声明：

```markdown
<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->
```

这条声明帮助后续 reviewer 一眼看出作者的密度意图，也防止无意中从 Compact 滑到 Detailed。

---

## §七 标准的历史与维护

- **2026-08-25 初版**：从本仓库 `docs/mvp/l1-design/02-instructions/` 五篇姊妹文档的踩坑经验沉淀。
- **维护原则**：
  - 任何新等级的阈值范围调整都应附 1-2 个**正例文档**作为锚定基准
  - 任何禁止区阈值的下调都应附 1-2 个**反例文档**（触发坍塌的）作为教训记录
  - 标准本身应保持 ≤ 等级 3（Detailed）水平——本文件本身就是最佳实践示范
- **跨项目权威源**：`~/.pi/DOCUMENT-DENSITY-STANDARDS.md`（全局权威）
- **项目级镜像**：`docs/mvp/DOCUMENT-DENSITY-STANDARDS.md`（本文件）