# 11 - 原型实现计划：从 L1 单元到端到端集成的渐进实现（迭代版）

> 本文档是**原型实现的行动指南**。核心原则是**自底向上、mock-first、迭代演进**。**本计划不是线性的——实施过程会出现多次反复、设计文档重写、检查点反思**。这是预期内的，不是失败。

---

## ⚠️ 计划的本质：迭代协议，不是线性路线图

### 0.1 现实假设

**实现过程必然出现以下情况**（这是预期，不是 bug）：

| 情况 | 概率 | 影响 |
|---|---|---|
| 实现发现 L1 类型设计缺陷 | 高 | 需修改 types.ts，可能更新 doc 09/10 |
| 实现发现 L2 op 接口不合理 | 中 | 需修改 operation.ts，可能更新 doc 06 |
| 实现发现 L3 编译逻辑 bug | 高 | 需修改 dag-compiler.ts，可能更新 doc 07 |
| 测试发现设计文档模糊 | 极高 | 需重写相关章节 |
| 集成发现层间契约错位 | 高 | 需调整多层接口 |
| 性能问题需要架构调整 | 低 | 可能重大重构 |
| 设计实现后觉得过度设计 | 中 | 需简化代码 + 更新文档 |

### 0.2 反馈循环图

```
   ┌─────────────────────────────────────────┐
   ↓                                          │
设计文档（doc 06-10）                          │
   ↓                                          │
   ├──→ Phase A 实现 → 测试                    │
   │         ↓                                │
   │         ├─ 通过 → 继续 Phase B            │
   │         │                                │
   │         ├─ 局部问题 → 修复代码（<2小时）    │
   │         │                                │
   │         └─ 设计缺陷 → ⭐ 暂停 Phase，      │
   │                        重写相关文档        │
   │                        修改计划            │
   │                        继续                │
   │                                          │
   ├──→ Phase B 实现 → 测试                    │
   │         ↓                                │
   │         ├─ 通过 → 检查点反思               │
   │         │                                │
   │         └─ 设计缺陷 → ⭐ 回到 Phase A      │
   │                        修改 L1 设计        │
   │                        可能重写 doc 10     │
   │                                          │
   └──→ Phase C/D/E 同理                       │
                                            │
   └────────────────────────────────────────────┘
```

### 0.3 检查点（强制暂停点）

**每个 Phase 完成后必须停下来反思**，不能自动跳到下一 Phase：

| 检查点 | 时机 | 必须做的事 |
|---|---|---|
| **Gate-A** | Phase A 完成后 | 评估 L1 设计是否需要调整 ✅ [FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-a-fdr.md) |
| **Gate-B** | Phase B 完成后 | 评估 L2 设计是否需要调整 ✅ [FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-b-fdr.md)（含 evaluate_expr 重构）|
| **Gate-C** | Phase C 完成后 | 评估 L3 设计是否需要调整 ✅ [FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-c-fdr.md)（MVP 三层全链路贯通）|
| **Gate-D** | Phase D 完成后 | 评估整体集成是否需要调整 ✅ [FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-d-fdr.md)（递归循环/多经验协作/错误恢复；200 层递归 8ms）|
| **Gate-E** | Phase E 完成后 | 评估端到端是否需要调整 ✅ [FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-e-fdr.md)（**MVP 收官**：557 tests / 99.02% lines）|

**每个检查点最长 4 小时**，必须输出**反思报告**（见下文）。

### 0.4 重写协议

**设计文档重写不是失败，是演进**。但需遵守协议：

#### 触发条件（满足任一即可触发重写）

1. **测试无法通过，且根因是设计文档模糊**（不是代码 bug）
2. **实现后发现设计有根本性错误**（如类型系统无法表达某场景）
3. **新想法让旧设计变得不必要**（如发现5 primitive 太多）
4. **性能测试显示架构有严重问题**
5. **集成测试发现层间契约矛盾**

#### 重写流程

```
1. 暂停当前 Phase
2. 写"设计反馈报告"（FDR, Feedback Report）
3. 在计划文档追加"重写记录"
4. 修改设计文档（doc 06-10 中相关章节）
5. 修改当前 Phase 实现
6. 重新跑该 Phase 的所有测试
7. 评估后续 Phase 是否需要调整
8. 决定：继续 / 调整后续 Phase / 重启整个流程
```

#### 重写记录格式

```markdown
## [日期] 重写记录 #N

**触发 Phase**：A3
**根本原因**：[一句话]
**影响范围**：[doc 06 §3 / doc 10 §三 / types.ts]
**改动摘要**：[具体变化]
**代价**：[已用时间 / 剩余时间]
**决策**：[继续 / 调整后续 / 重启]
```

---

## 反馈报告（FDR）模板

**每个检查点必须填写**：

```markdown
## Gate-X 反馈报告

**日期**：[日期]
**完成 Phase**：[A/B/C/D/E]
**通过测试**：[N 个]

### 一、发现的实现问题（具体）
- [问题 1]：
  - 现象：[测试失败描述 / 调试发现]
  - 根因：[设计缺陷 / 接口模糊 / 文档没说清]
  - 严重度：[阻塞 / 一般 / 轻微]

### 二、发现的设计缺陷（影响文档）
- [缺陷 1]：
  - 在文档：[doc 06 §3]
  - 现状：[模糊 / 错误 / 缺失]
  - 影响：[无法实现 / 容易出错 / 性能差]

### 三、新想法（之前没想到的）
- [想法 1]：
  - 内容：[描述]
  - 来源：[实现时 / 测试时 / 集成时]
  - 价值：[改进 / 简化 / 优化]

### 四、决策
- [ ] 继续下一 Phase（无问题）
- [ ] 修改当前 Phase 后继续（小问题）
- [ ] 修改设计文档后继续（设计问题）
- [ ] 暂停全面反思（重大问题）

### 五、对后续 Phase 的影响
- [Phase B 计划调整 1]：[描述]
- [Phase B 新增 tier]：[描述]

### 六、文档更新清单
- [ ] doc 06 §X：[具体修改]
- [ ] doc 10 §X：[具体修改]
- [ ] types.ts：[具体修改]
```

---

## 核心原则

### 1.1 自底向上（Bottom-up）

```
L1 (Runtime)        ← 最底层，无业务语义，最先实现并测试
   ↓ 依赖
L2 (Operations)     ← 原子操作，业务无关
   ↓ 依赖
L3 (Service)        ← 意图分解，业务语义
   ↓ 依赖
L4 (LLM)            ← 最顶层，最后集成
```

**为什么从 L1 开始？**
- L1 词汇表（5 primitive）是无业务语义的——可以脱离具体业务逻辑单独测试
- L2、L3 都依赖 L1 的调度能力
- L1 错误最易定位和修复
- 一旦 L1 稳固，上层只需关注自己的业务逻辑

### 1.2 Mock-first

**每个层级测试时，下层/上层的依赖都用 mock**：

| 测试目标 | Mock 的依赖 |
|---|---|
| L1 primitive | L2 operation, L3 service（注入 mock） |
| L2 operation | 文件系统（用 tmpdir + 真实 IO）|
| L3 compile | L1 scheduler（验证返回的 StackEntry 数组） |
| 集成测试 | 全部真实（除了文件系统等外部 IO） |

**为什么 mock-first？**
- 单元测试失败时，能立刻定位是 L1 的 bug 还是 L2 的 bug
- L1 测试速度更快（不需要真实 IO）
- L1 调试更容易（不需要构造复杂的 L2 场景）
- 集成测试聚焦于"组件配合"，不重复单元测试已覆盖的内容

### 1.3 三层测试金字塔 + 迭代反馈

```
        ╱╲
       ╱  ╲         E2E 测试（1-2 个）         ─┐
      ╱ L4 ╲        验证用户场景完整链路          │ Phase E
     ╱──────╲                                   │
    ╱  集成  ╲       集成测试（5-8 个）          ─┤ Phase D
   ╱ L1+L2+L3 ╲    验证组件配合                 │
  ╱────────────╲                                │
 ╱   单元测试   ╲   单元测试（20-30 个）         ─┘ Phase A-C
╱ L1│L2│L3 分层 ╲  验证每个组件独立正确
──────────────────
         ↓
    检查点反思（每个 Phase 后）
         ↓
    可能的设计文档重写
         ↓
    继续下一 Phase（带调整）
```

---

## 实现阶段总览

```
Phase A: L1 Foundations（13 个 tier，全部用 mock L2/L3）
   ↓ Gate-A 反思（可能重写 doc 09/10）
Phase B: L2 Operations（4-5 个 tier，真实实现）
   ↓ Gate-B 反思（可能重写 doc 06）
Phase C: L3 Service（5 个 tier，真实实现 + 标准意图库）
   ↓ Gate-C 反思（可能重写 doc 07/10）
Phase D: Integration（5 个 tier，全栈集成）
   ↓ Gate-D 反思（可能重写多个 doc）
Phase E: L4 + E2E（2 个 tier，端到端）
   ↓ Gate-E 反思
完成 / 迭代回到相关 Phase
```

**⚠️ 注意**：Phase 数量可能因反思而调整。**示例**：Gate-A 反思发现需要增加 L1 primitive（如 backward_jump），则 Phase A 增加 tier，A 完成后 Phase B 可能简化（因为 L1 已支持循环原语）。

---

## 迭代缓冲预算

### 总时间预算（含迭代）

| 阶段 | 计划时间 | 迭代缓冲 | 总计 |
|---|---|---|---|
| Phase A | 3 天 | + 1 天 | 4 天 |
| Phase B | 1 天 | + 0.5 天 | 1.5 天 |
| Phase C | 1.5 天 | + 0.5 天 | 2 天 |
| Phase D | 1.5 天 | + 0.5 天 | 2 天 |
| Phase E | 0.5 天 | + 0.5 天 | 1 天 |
| 检查点反思 | — | + 0.5 天（5 次）| 2.5 天 |
| **总计** | **7.5 天** | **+ 3.5 天** | **~11 天** |

### 迭代缓冲的使用规则

- **< 0.5 天**：小调整（修复代码、改测试）
- **0.5-1 天**：中等调整（修改一个 Phase 的部分 tier）
- **1-2 天**：大调整（重写一个 Phase 的多个 tier）
- **> 2 天**：重大问题，需要全面反思

**若迭代缓冲超过 3.5 天**，说明设计文档需要全面重写（不仅是局部修订）。

---

## 详细 Phase 计划（每个 tier 内嵌"反思触发"）

### Phase A：L1 Foundations（13 个 tier，mock-first）

#### A0：项目骨架 + Mock 基础设施

**目标**：建立 tsconfig、vitest、目录结构、mock helpers

**反思触发**：
- ❓ 如果 mock L2 写得太复杂（> 50 行）→ **简化设计**
- ❓ 如果 vitest 配置有问题 → **换测试框架或修复**

**文件**：
- `package.json`、`tsconfig.json`、`vitest.config.ts`
- `src/mocks/mock-l2.ts`、`src/mocks/mock-l3.ts`
- `tests/helpers.ts`

**测试**：1 个 sanity test

---

#### A1：Type 定义层

**目标**：定义 StackEntry、Address、Value

**反思触发**：
- ❓ 如果发现需要新的 Address 类型（如 stream）→ **评估是否 MVP 需要，可能扩展**
- ❓ 如果发现 5 primitive 不够用 → **重写 doc 06 §3，重新设计词汇表**
- ❓ 如果 TypeScript 穷尽检查失败 → **类型设计错误，修复**

**文件**：`src/l1/types.ts`（~100 行）

**测试**：类型实例化 + 穷尽检查

---

#### A2：ExecutionState（双区 + RegisterAllocator）✅ 已完成

**目标**：定义 ExecutionState 双区（publicStore + internalStore）+ RegisterAllocator

**双区架构**：
- `publicStore: Map<string, Value>` — 业务数据（业务命名，持久）
- `internalStore: Map<string, Value>` — 寄存器（`$r<N>` 命名，瞬态）
- `allocator: RegisterAllocator` — L1 拥有，每个外部意图循环初始化一次
- `$r_err` 是保留寄存器名（错误全局寄存器）

**RegisterAllocator 接口**：
- `allocate(): string` — 返回 `$r0`, `$r1`, `$r2`,...
- `static errorRegister(): string` — 返回 `$r_err`
- `reset(): void` — 重置计数器（外部意图重置）

**反思触发**：
- ❓ 如果业务/寄存器命名混淆 → ✅ **双区架构已解决**
- ❓ 如果需要事务 → **MVP 不需要**

**文件**：`src/l1/execution-state.ts`（~80 行）

**测试**：25 个

**设计反馈**：2026-08-20 重写从 resultStore 单区改为双区

---

#### A3：Address 解析器（双区）✅ 已完成

**目标**：resolveAddress / writeAddress 处理 4 kinds Address（literal/public/internal/file）

**双区约束**：
- resolveAddress(literal) → 直接返回值
- resolveAddress(public) → 从 publicStore 读（不存在抛 AddressError）
- resolveAddress(internal) → 从 internalStore 读（不存在抛 AddressError）
- resolveAddress(file) → 从 fs 读（IO 错误抛 AddressError）
- writeAddress(literal) → 抛 AddressError（不允许）
- writeAddress(public) → 写入 publicStore
- writeAddress(internal) → 写入 internalStore
- writeAddress(file) → 写入文件

**反思触发**：
- ❓ 如果 Address 解析有歧义 → ✅ **双区分离业务/寄存器**
- ❓ 如果需要字段路径 → **MVP 不实现**

**文件**：`src/l1/address-resolver.ts`（~110 行）

**测试**：25 + 9 (a03c) = 34 个

**2026-08-20 增强（AddressError.code）**：
- `AddressError` 加 `code: string | undefined` 字段
- 错误分类：LITERAL_WRITE / VARIABLE_NOT_FOUND / 原始 fs code（ENOENT, EACCES, ...）
- 使 DAG 能基于错误类型决策（不仅是 truthy 判断）
- 详细见 `mvp-prototype/docs/dev-log/2026-08-20-coverage-reflection.md`

---

#### A4：move primitive（双区）✅ 已完成

**目标**：实现 move，跨区搬运数据（literal/public/internal/file → 任意非 literal）

**约束**：
- from 可以是任何 Address kind
- to **不能是 literal**（报 AddressError）
- 跨区 move 是合法的（public → internal, file → public, etc.）

**反思触发**：
- ❓ 如果发现 move 比预期复杂 → ✅ **双区架构简化**

**文件**：`src/l1/primitives/move.ts`（~30 行）

**测试**：25 个

---

#### A5：skip_n primitive（双区） 🔲 下一步

**目标**：实现 skip_n 处理函数

**说明**：
- skip_n 不访问 Address（不需要双区相关）
- 弹出 self + n 个后续 entry

**反思触发**：
- ❓ 如果 n=0 边界有歧义 → **明确语义**

**反思触发**：
- ❓ 如果发现需要 skip_n(-n)（backward jump）→ **重写 L1 词汇表**，考虑在 L3 实现循环

---

#### A6：conditional_skip primitive（双区） 🔲 待办

**目标**：实现 conditional_skip，从 internalStore 读条件值

**双区约束**：
- conditionAddr 必须是 `internal` kind
- 从 `internalStore` 读条件值（不读 resultStore）

**典型用法**：检查 `$r_err`
```typescript
{ kind: 'conditional_skip', conditionAddr: { kind: 'internal', name: '$r_err' }, n: 2 }
```

**反思触发**：
- ❓ 如果发现条件判断逻辑复杂 → **简化 truthy 规则**

---

#### A7：execute_op（用 mock L2） 🔲 待办

**目标**：实现 execute_op，调用 mock L2 op

**双区约束**：
- inputs/outputs 中所有 Address 必须是 `internal`（运行时校验）
- outputs 写入 `internalStore`（不是 resultStore）
- 错误输出通常写到 `$r_err`

**mock L2 接口**：
- mock_op: `formalSpec = { inputs: { x: { register: '$r0' } }, outputs: { result: { register: '$r1' } } }`
- throwing_op: 总是 throw（测试异常冒泡路径）

**反思触发**：
- ❓ 如果 outputs 写入逻辑有歧义 → **重新设计 key 机制**
- ❓ 如果发现异常处置权分界不清 → **重写 op 契约**

---

#### A8：execute_intent（用 mock L3） 🔲 待办

**目标**：实现 execute_intent，调用 mock L3 service

**L3 contract**：
- L3 接收 `state`（含 allocator）
- L3 调用 `state.allocator.allocate()` 分配寄存器
- L3 返回 `StackEntry[]`（children）
- 递归 intent 重用同一 allocator（通过 state）

**mock L3 接口**：
- createMockL3(children): 总是返回给定 children
- createSpyL3(children): 同上 + 追踪调用

**反思触发**：
- ❓ 如果发现 children 压栈顺序错误 → **修复 DFS 逻辑**
- ❓ 如果发现 phase 状态机不完整 → **增加状态**

---

#### A9：5-case main loop（双区） 🔲 待办

**目标**：集成所有 primitive，双区数据流

**反思触发**：
- ❓ 如果发现 main loop 有性能问题 → **评估优化**
- ❓ 如果发现 switch 顺序导致问题 → **重排**

---

#### A10：异常冒泡（双区） ✅ 已完成（2026-08-20）

**目标**：实现 bubbleError（异常冒泡，处置权在 L3 handleError 标志）

**修订**：原"硬错误 propagateHardError 逐层 abort"设计已废弃（用户 2026-08-20 确认）：
错误处置权在 L3（handleError 标志），L1 只做机械冒泡（写 $r_err → 找最近 handler → 截获/传播）。

**反思触发**：
- ❓ **关键节点**：如果错误传播算法有根本问题 → **重新设计 L1 错误处理**，可能回到 doc 10 重写
- ❓ 如果多层嵌套下栈操作出错 → **画图验证，可能引入栈深度限制**

---

#### A11：递归深度跟踪 ✅ 已完成（2026-08-20）

**目标**：实现 enterIntent / exitIntent → **解耦**（独立模块 src/l1/recursion.ts，调用点在主循环）

**实现要点**：
- recursionDepth: Map<intent.type, depth>；默认上限 1000（L1RunOptions.maxRecursionDepth 可配）
- RecursionDepthError 不走业务冒泡（与 L1MaxStepsError 同类）
- skip 帧边界保护细化：pending 帧可跳过（循环终止），awaiting/aborted 帧不可跨
- bubbleError 弹出帧时 abortFrame（exitIntent + aborted）——深度不泄漏

**反思触发**：
- ❓ 如果发现递归深度跟踪与 execute_intent 耦合 → **已解耦**（reflection satisfied）

---

#### Gate-A 检查点（**强制暂停，最长 4 小时**）

**必须完成的事**：

1. **完整跑 Phase A 所有测试**——确保不退化
2. **写 FDR（Feedback Report）**——见上文模板
3. **评估 L1 设计**：
   - 5 primitive 是否足够？需要增加吗？（如 backward jump、parallel）
   - 词汇表与 doc 06 §3 是否一致？
   - Address 解析是否清晰？
   - 错误传播算法是否优雅？
4. **评估 doc 09/10 是否需要修订**——可能发现 doc 与实现脱节
5. **评估后续 Phase 计划**：
   - Phase B 是否要增加 tier？
   - Phase C 是否需要调整 L3 假设？

**典型决策**：

| 情况 | 决策 |
|---|---|
| Phase A 全部测试通过，无新问题 | 继续 Phase B |
| 发现 L1 vocabulary 太小（如缺 backward jump）| 暂停，回 doc 06 §3 修改 |
| 实现与文档脱节 | 更新 doc 09/10 |
| 发现异常冒泡有 bug | 重新设计 Phase A10 |
| 发现性能问题 | 重构 L1 |

**预算时间**：计划 4 小时；若超出说明需要全面反思。

---

### Phase B：L2 Operations（4-5 个 tier，真实实现）

**进入 Phase B 的前置条件**：
- [x] Phase A 所有测试通过（350/350，21 文件，99.83% lines）
- [x] Gate-A FDR 已完成（dev-log/2026-08-20-gate-a-fdr.md）
- [x] L1 设计已确定（5 primitive + 循环机制验证 + doc 09/10 同步完成）

> **2026-08-20 Gate-A 结果**：继续 Phase B。
> - 5 primitive 足够（循环 = 递归 + cond_skip，A11 验证；无需 backward jump/parallel）
> - A11 新增：递归深度跟踪（enterIntent/exitIntent + RecursionDepthError）+ skip 帧边界细化（pending 可跳过）
> - 文档修复：doc 10 §6.5 循环 truthy 语义错误、doc 10 §3.1-3.8 A11 脱节、doc 09 递归段旧模型
> - 完整评估见 dev-log/2026-08-20-gate-a-fdr.md

#### B1：file_read

**反思触发**：
- ❓ 如果发现 ENOENT/EACCES 等错误代码不够 → **扩展错误分类**
- ❓ 如果发现真实文件 IO 与 mock 行为不一致 → **调整 mock 行为匹配**

#### B2：file_write

**反思触发**：
- ❓ 如果发现原子写入需求 → **评估是否 MVP 需要**

#### B3：shell_exec

**反思触发**：
- ❓ 如果发现 shell 注入风险 → **增加安全约束**
- ❓ 如果发现 timeout 处理复杂 → **考虑是否 MVP 需要**

#### B4：counter ops

**反思触发**：
- ❓ 如果发现需要持久化 counter → **评估存储方案**

#### B5（脱碳）2026-08-20 重构：表达式求值 op

**设计反馈**（见 dev-log/2026-08-20-evaluate-expr-redesign.md）：
- **关键事实**：L1 primitives 完全不调用任何比较/逻辑/算术 op。B06 实现的 12 个独立条件 op 是**错误的关注点切分**。
- **重构决策**（用户 2026-08-20 确认）：
  1. **删除** B06 实现的 11 个独立 op：equals / not_equals / gt / lt / gte / lte / and / or / not / is_truthy / is_empty / extract_error_code
  2. **整合** extract_error_code 到 evaluate_expr（作为 `error_code` 操作符）
  3. **不实现** lambda（MVP 不需要）
  4. **新增** 位运算操作符（& | ^ ~ << >> >>>）
  5. **保留** sort_by / take_first（作为高层 API，调用更直观）

- **重构后**：22 个 op → **10 个 op**（文件4 + 进程1 + 数据处理5 + 表达式1 = 11 个）
  - 文件操作（4）：file_read / file_write / glob_match / grep_search
  - 进程操作（1）：shell_exec
  - 数据处理（5）：string_replace / sort_by / take_first / increment_counter / decrement_counter
  - **表达式求值（1）：evaluate_expr**（内置完整 JSON 树形求值器）

- **DAG 简化**：编译 `if code == 'ENOENT' and not empty(items)` 从 5-6 个 execute_op 减少为 **1 个 execute_op(evaluate_expr)**。L3 编译器职责从"组合原子 op"变为"构造表达式 JSON 树"。

详见 [doc 06 §7.2.1](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构) 完整设计。

#### Gate-B 检查点

**评估**：
- L2 op 接口是否合理？
- 错误处理是否符合"L3 handleError 处置权"原则？
- 是否需要增加/删除某些 op？

> **2026-08-20 Gate-B 结果**：原 Gate-B 文档说明为初版 B01-B06 实现后。现重构后 Gate-B 补充：
> - **删除** 12 个独立条件 op → 净减 12 个
> - **新增** evaluate_expr → 净增 1 个
> - 净变化：22 → 11 个 L2 op（**减少 50%**）
> - 详细评估见 dev-log/2026-08-20-gate-b-fdr.md

---

### Phase C：L3 Service（7 个 tier，Experience 模型）

> **✅ 已完成（2026-08-20，Gate-C 通过）**：实际实现与原计划 tier 划分有合并调整，
> 详见 [Gate-C FDR](../mvp-prototype/docs/dev-log/2026-08-20-gate-c-fdr.md)。
>
> **实现对照**：
>
> | 计划 tier | 实际落点 | 产出 |
> |---|---|---|
> | C1 类型定义 | commit `0c5965b` | experience.ts 类型对齐（D-C1-1 删 preprocessing ParamRef / D-C2-1 Expr AST trigger）|
> | C2+C3+C4 编译器 | commit `C2` | compiler.ts 五步静态展开统一实现（输入绑定/前置过滤/运行时分支/步骤编译），20 tests |
> | C5 嵌套调用 | commit `C6` | makeNestedIntent（params 限 literal/input，MVP 限制 D-C6-1）|
> | C6 Feedback | commit `C2` | ExperienceService.recordFeedback（存储不演化）|
> | C7 经验库 | commit `C5` | experience-library.ts 9 条核心经验 + 16 个真实 tmpdir E2E |
> | — | commit `C6` | 完整 E2E：嵌套 + handleError 三种截获场景，8 tests |
>
> **最终状态：530/530 passing，98.97% lines / 89.71% branches，三层全链路贯通。**

> **2026-08-20 重写**：原 Phase C 计划（5 个 tier，DAG compiler）已重写为 7 个 tier（Experience 模型）。
> 详见 [doc 12-experience-model.md](./12-experience-model.md) 完整设计响应。
>
> **关键变更**：
> - 从"DAG 节点类型"转为"Experience 三段式"（pre-processing + conditional + target-op）
> - 从"5 个 tier"扩展为"7 个 tier"（从最简单逐步扩展）
> - 加入 skip-cost 参数（0-100 浮点）的处理逻辑
> - 加入 Experience 调用关系（DAG 嵌套） tier
> - MVP 仅预定义，动态学习作为未来扩展

**重要依赖**（2026-08-20 重构后）：Phase C 的 Conditional-Judgment 编译需要 **表达式求值 op**（evaluate_expr）。该 op 已在 Phase B 末尾重构中实现（替代了原 12 个独立条件 op）。详见 [doc 06 §7.2.1](./06-execution-layer.md#721-表达式求值-opevaluate_expr-2026-08-20-重构)。

#### C1：Experience 数据结构定义

**目标**：定义 Experience / PreProcessing / ConditionalJudgment / TargetOp 数据结构

**实现**：
- `src/l3/types.ts`：Experience 相关类型定义
- `tests/phase-c/tier-c1-experience-types.test.ts`：类型正确性测试

**反思触发**：
- ❓ 如果类型不够灵活（如 trigger 表达受限）→ **扩展类型**
- ❓ 如果类型过于复杂（如 ParamRef union）→ **拆分或简化**

#### C2：Target-Op 简单执行（无 pre-processing、无 conditional）

**目标**：编译只有 target_op 的简单 Experience（如 read_file）

**实现**：
- `src/l3/compiler.ts`：compileExperience 函数（最初只支持 target_op）
- `src/l3/library.ts`：内置 read_file 经验
- `tests/phase-c/tier-c2-simple-target-op.test.ts`：编译验证

**反思触发**：
- ❓ **关键节点**：如果编译输出不符合 L1 期望 → **重写 compiler**
- ❓ 如果发现入参绑定逻辑有 bug → **修正 bindInputs**

#### C3：Pre-Processing（带 skip-cost 跳过逻辑）

**目标**：支持前置处理收集数据，根据 skip-cost 跳过

**实现**：
- `src/l3/compiler.ts`：扩展 compileExperience 加 pre_processing 步骤
- `tests/phase-c/tier-c3-pre-processing.test.ts`：跳过/执行验证

**反思触发**：
- ❓ 如果 skip_cost 与 skip_threshold 语义不清 → **明确语义**
- ❓ 如果前置处理输出传递出错 → **修正寄存器绑定**

#### C4：Conditional-Judgment（多路径选择）

**目标**：支持条件判断，决定 target-op 走哪条路径

**实现**：
- `src/l3/compiler.ts`：扩展加 conditional_judgment 步骤
- **编译为 execute_op(evaluate_expr, { expr: trigger }, { result }) + conditional_skip + skip_n**（单一 op 替代旧 5-6 op 链）
- 表达式 trigger 是 JSON 树（**由 L3 编译器生成**，不来自 LLM）
- `tests/phase-c/tier-c4-conditional-judgment.test.ts`：路径选择验证

**反思触发**：
- ❓ **关键节点**：如果条件编译逻辑有 bug → **重写条件编译**
- ❓ 如果发现表达式求值性能不够 → **评估编译缓存**

#### C5：Experience 调用（DAG 嵌套）

**目标**：支持经验之间调用（一个经验内部调用另一个经验）

**实现**：
- `src/l3/compiler.ts`：检测 OpStep.operation 是否匹配 Experience.id
- 如果是经验，生成 execute_intent entry（而非 execute_op）
- `tests/phase-c/tier-c5-experience-call.test.ts`：嵌套调用验证

**反思触发**：
- ❓ 如果递归深度无限制 → **加入 max depth 防护**
- ❓ 如果经验调用与 execute_op 调用混淆 → **明确区分**

#### C6：Feedback 记录（MVP 不演化）

**目标**：实现 feedback_history 存储接口（不自动调整）

**实现**：
- `src/l3/service.ts`：添加 recordFeedback 方法
- `tests/phase-c/tier-c6-feedback-record.test.ts`：存储验证

**反思触发**：
- ❓ 如果需要立刻看到反馈生效 → **重新评估 MVP 边界**

#### C7：标准经验库（5-10 条核心经验）

**目标**：内置 5-10 条常用经验

**实现**：
- `src/l3/library.ts`：内置 read_file、shell_exec、search_in_files、edit_file、read_latest_file 等
- `tests/phase-c/tier-c7-experience-library.test.ts`：覆盖每条经验

**反思触发**：
- ❓ 如果某条经验设计过于复杂 → **拆分或简化**
- ❓ 如果发现遗漏关键经验 → **考虑加入下一批**

#### Gate-C 检查点

**评估**：
- Experience 三段式结构是否合理？
- skip-cost 参数语义是否清晰？
- 条件判断编译是否符合 L1 期望？
- 经验调用 DAG 是否正确？
- 反馈存储是否完整？

**可能的设计调整**：
- 如果条件编译过于复杂 → 考虑简化 trigger 类型
- 如果 skip_cost 使用不便 → 考虑预定义 skip levels
- 如果经验库初期不成熟 → 推迟某些经验到 Phase E

### Phase C 时间预算（调整后）

| Tier | 预估 | 缓冲 |
|---|---|---|
| C1 | 0.25 天 | +0.25 天 |
| C2 | 0.5 天 | +0.25 天 |
| C3 | 0.5 天 | +0.25 天 |
| C4 | 0.75 天 | +0.25 天 |
| C5 | 0.5 天 | +0.25 天 |
| C6 | 0.25 天 | +0 天 |
| C7 | 0.75 天 | +0.5 天 |
| **总计** | **3.5 天** | **+1.75 天** |

原 5-tier 计划：2 天 → 7-tier 新计划：**5.25 天**（多 3.25 天）

**预算增加理由**：
- 7 个 tier 比 5 个 tier 多（多 2 个）
- 条件编译逻辑更复杂（C4）
- 经验调用嵌套是新需求（C5）
- 跳过成本参数处理是新逻辑（C3）

---

### Phase D：Integration（5 个 tier）

#### D1：L1 + L2 集成

**反思触发**：
- ❓ 如果发现层间接口不匹配 → **回到 Phase A/B 修改**

#### D2：L1 + L2 + L3 集成

#### D3-D5：场景集成

**反思触发**：
- ❓ **关键节点**：如果循环 E2E 无法跑通 → **回到 Phase A 重写递归机制**

#### Gate-D 检查点

**评估**：
- 整体集成是否流畅？
- 是否有不必要的复杂度？
- 性能是否可接受？

---

### Phase E：LLM + E2E（2 个 tier）

#### E1：LLM Mock

**反思触发**：
- ❓ 如果 mock LLM 太简单无法测试真实场景 → **改进 mock**

#### E2：完整端到端

**反思触发**：
- ❓ **关键节点**：如果端到端跑不通 → **回到相关 Phase 修复**

#### Gate-E 检查点（最终评估）

**评估**：
- MVP 是否达成？
- 哪些设计假设被推翻？
- 哪些设计被证明有效？
- 下一步：扩展 / 优化 / 重构？

---

## 重写记录区（实施时填写）

> 本节由实施者在每次重写后追加。

### 重写记录 #0（初始设计）

**日期**：[实施日期]
**触发 Phase**：—
**根本原因**：—
**改动摘要**：—
**代价**：—
**决策**：—

---

### 重写记录 #1（示例）

**日期**：[实施日期]
**触发 Phase**：A7
**根本原因**：outputs 写入时用 variable name 直接做 key，导致不同 entry 的同名 variable 冲突
**影响范围**：
- `src/l1/types.ts` OpEntry.outputs
- `src/l1/execution-state.ts` resultStore key 机制
- doc 06 §3（Address 设计）
- doc 10 §二（数据结构）
**改动摘要**：从 `state.resultStore.set('$x', value)` 改为使用双区架构 — `state.internalStore.set('$r<N>', value)`，所有 execute_op 的 outputs 通过 formalSpec.register 映射到 internalStore
**代价**：1.5 天（修改 types + 重写 A7/A8/A9 测试）
**决策**：继续 Phase A，增加 A8.5 验证 key 隔离

---

## 反思报告归档区（每个 Gate 后填写）

> 本节由实施者在每个检查点追加。

### Gate-A 反思报告

**日期**：[实施日期]
**完成 Phase**：A（13 个 tier）
**通过测试**：[N 个]

#### 一、发现的实现问题
- [问题 1]：
  - 现象：—
  - 根因：—
  - 严重度：—

#### 二、发现的设计缺陷
- [缺陷 1]：
  - 在文档：—
  - 现状：—
  - 影响：—

#### 三、新想法
- [想法 1]：—

#### 四、决策
- [ ] 继续下一 Phase

#### 五、对后续 Phase 的影响
- [Phase B 调整]：—

#### 六、文档更新清单
- [ ] doc 09 §X：—

---

### Gate-B 反思报告

（同上结构）

---

## 项目结构（含调试工具）

```
mvp-prototype/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   └── dev-log/                    # ⭐ 实施日志
│       ├── 2026-08-20-a01.md      # 每个 tier 一份日志
│       ├── 2026-08-21-a07.md
│       └── gates/
│           ├── gate-a-fdr.md      # 每个 Gate 一份 FDR
│           └── gate-b-fdr.md
├── src/
│   ├── l1/
│   ├── l2/
│   ├── l3/
│   ├── l4/
│   ├── mocks/
│   └── index.ts
└── tests/
    ├── phase-a/
    ├── phase-b/
    ├── phase-c/
    ├── phase-d/
    └── phase-e/
```

### 实施日志格式（每个 tier 一份）

```markdown
## [Tier 名称] 实施日志

**日期**：[日期]
**用时**：[实际用时]
**状态**：[通过 / 修复后通过 / 重写]

### 实现细节
- 关键决策点 1：—
- 关键决策点 2：—

### 发现的问题
- 问题 1：—

### 与设计文档的差异
- 差异 1：—

### 反思
- 收获 1：—
```

---

## 风险区域（更详细）

### R1. Mock 复杂度风险

**症状**：mock L2/L3 写得过于复杂，失去意义。

**应对**：
- mock 只保留必要接口
- mock 行为用最少代码表达
- 若 mock 复杂 → 说明设计接口复杂 → 反思接口设计

### R2. 单元 vs 集成边界模糊

**症状**：单元测试开始依赖其他层。

**应对**：
- 严格标准："单元测试不依赖其他层的真实实现"
- 若违反 → 移到集成测试

### R3. 设计文档脱节

**症状**：实现与文档不符（可能是文档错或实现错）。

**应对**：
- 每次发现脱节立即记录
- Gate 检查点统一处理
- 不要隐瞒脱节——文档错误也是重要信息

### R4. 范围蔓延（Scope Creep）

**症状**：实现时不断加新功能。

**应对**：
- 严格按 Phase 计划执行
- 新想法先记录，不立即实现
- 在 Gate 评估新想法，决定是否纳入

### R5. 过度设计（Over-engineering）

**症状**：实现时加了一堆"未来可能用到"的功能。

**应对**：
- MVP 原则：只实现当前测试需要的功能
- Gate 评估代码复杂度

### R6. 时间预算超支

**症状**：迭代缓冲用完还没完成。

**应对**：
- **这是信号**，说明设计有根本问题
- 暂停，审视整个设计
- 可能需要：
  - 缩小 MVP 范围
  - 简化某些层
  - 重写关键章节

### R7. 反馈循环未触发

**症状**：发现设计问题但没停下来，导致技术债累积。

**应对**：
- **强制**：每个 Tier 完成后必须写简短反思（即使"无问题"也要写）
- 每个 Gate 必须写完整 FDR
- 重写记录必须诚实记录

---

## 累计统计（含迭代）

| 阶段 | 计划代码 | 测试数 | 迭代缓冲 | 总时间 |
|---|---|---|---|---|
| Phase A | ~400 行 | ~30 | +1 天 | 4 天 |
| Phase B | ~150 行 | ~10 | +0.5 天 | 1.5 天 |
| Phase C | ~200 行 | ~12 | +0.5 天 | 2 天 |
| Phase D | ~150 行 | ~10 | +0.5 天 | 2 天 |
| Phase E | ~100 行 | ~5 | +0.5 天 | 1 天 |
| Gate 反思 | — | — | +2.5 天 | 2.5 天 |
| **总计** | **~1000 行** | **~67 个** | **+5 天** | **~13 天** |

---

## 开发节奏建议（**实际不一定按此执行**）

### 计划（指导性）

#### Day 1-4（Phase A）
- A0-A11 + Gate-A 反思

#### Day 5-6（Phase B）
- B1-B4 + Gate-B 反思

#### Day 7-8（Phase C）
- C1-C5 + Gate-C 反思

#### Day 9-10（Phase D）
- D1-D5 + Gate-D 反思

#### Day 11（Phase E）
- E1-E2 + Gate-E 反思

### 实际节奏（**允许偏差**）

**若 Day 2 发现 Phase A 需要重写**：
- 暂停 A3+
- 回 doc 09/10 重写
- 重新实施 A0-A2
- 可能 Day 4 仍在 Phase A

**若 Day 6 发现 Phase B 不需要某些 op**：
- 简化 B3（如不需要 shell_exec，跳过）
- Day 5 完成 Phase B

**关键是**：实际节奏服从于设计和质量，不服从于计划。

---

## 验收里程碑（**可能因迭代而调整**）

| 里程碑 | 标志 | 备注 |
|---|---|---|
| **MVP-A** | Phase A 全部测试通过 | **强制** Gate-A 反思后才能进入 Phase B |
| **MVP-B** | Phase B 全部测试通过 | Gate-B 反思 |
| **MVP-C** | Phase C 全部测试通过 | Gate-C 反思 |
| **MVP-D** | Phase D 全部测试通过 | Gate-D 反思 |
| **MVP-E** | Phase E 全部测试通过 | Gate-E 反思 |

**注意**：里程碑可能在迭代中重新定义。

---

## 设计债务追踪

**实施过程中发现的设计债务**：

| ID | 描述 | 发现 Phase | 状态 | 决定 |
|---|---|---|---|---|
| DD-001 | [示例] backward_jump 未支持，MVP 暂不支持 | A5 | 接受 | 留待后续 |
| DD-002 | | | | |
| DD-003 | | | | |

**类别**：
- **阻塞**：必须修复才能继续
- **重要**：下一 Phase 处理
- **接受**：留待 MVP 之后
- **驳回**：不算问题

---

## 下一步

### 关键行动

1. **接受计划是迭代协议，不是承诺**
2. **从 Phase A Tier A0 开始**——先建立 mock 基础设施
3. **每完成一个 tier 写简短日志**（即使"无问题"）
4. **每个 Phase 完成后做 Gate 反思**
5. **诚实记录问题和重写**——不要为了进度而隐瞒

### 何时暂停

- 实现卡住 > 2 小时 → 停下来反思
- 发现设计文档模糊 > 1 小时没解决 → 暂停，修订文档
- 多个 tier 都依赖某未知设计 → 必须先解决

### 何时继续

- 当前 Phase 测试通过
- Gate 反思完成
- 下一 Phase 依赖已就绪

---

## 致未来实施者

**本计划是协议，不是合同**：

- 计划可能错——实施发现后立即修正
- 时序可能变——Phase C 可能比 Phase A 简单
- 设计可能改——doc 10 可能被重写
- 词汇表可能缩——5 primitive 可能减为 4

**关键不是"按计划完成"，而是"建立可持续的迭代节奏"**：

- 每步小而稳
- 每步可验证
- 每步可回退
- 每步可调整

**成功标准不是"零修改"，而是"每次修改都有明确理由"**。

---

## 架构重大重写记录（2026-08-20）

> 详见 `mvp-prototype/docs/dev-log/2026-08-20-design-feedback-major-rewrite.md`

### 重大变更

| 项目 | 旧设计 | 新设计（双区架构）|
|---|---|---|
| ExecutionState | `resultStore: Map<string, Value>` | `publicStore + internalStore + allocator` |
| Address kinds | 5: literal/variable/file/stream/field | 4: literal/public/internal/file |
| Operation schema | `inputs/outputs: ParamSpec` | `formalSpec: OperationFormalSpec` |
| FormParam | 无 | `businessName` + `register`（必填） |
| 错误结构 | 各自定义 | 标准 `OperationError` |
| 错误寄存器 | （未定义） | 单个 `$r_err` |
| 寄存器分配 | （未定义）| `RegisterAllocator`（L1 拥有）|

### 已完成 tier

- ✅ A0：项目骨架 + Mock 基础设施
- ✅ A0b：手动 L2 调用演示
- ✅ A0c：L2Registry 测试
- ✅ A1：完整定义 5 StackEntry 类型
- ✅ A1b：FormalParam 测试
- ✅ A1c：OperationError 测试
- ✅ A1d：Address type guards 测试
- ✅ A1e：StackEntry type guards 测试
- ✅ A2：ExecutionState + resultStore → **重写为 ExecutionState + publicStore/internalStore + RegisterAllocator**
- ✅ A3：Address 解析器 → **重写为 4 kinds Address 解析**
- ✅ A3c：AddressError.code 字段验证（错误码保留）
- ✅ A4：move primitive → **重写为新约束（to ≠ literal）**
- ✅ A5：skip_n primitive（含帧边界保护 2026-08-20）
- ✅ A6：conditional_skip primitive（含帧边界保护 2026-08-20）
- ✅ A7：execute_op primitive + 可编程 mock L2
- ✅ A7.5：原型重构 — 适配 Experience 模型（L3Service + mock）
- ✅ A8：execute_intent primitive → **帧保留语义（2026-08-20 修订）**
- ✅ A9：l1MainLoop — 5-case dispatch
- ✅ A10：异常冒泡（bubbleError + handleError）→ **错误处置权在 L3（用户设计修正）**
- ✅ A11：递归深度跟踪（enterIntent/exitIntent + RecursionDepthError）→ **循环安全网；skip 帧边界细化**

**累计测试**：350/350 passing（21 文件）。

**2026-08-20 Phase B 增补**（重构后）：

- ✅ B01：file_read（13 tests）
- ✅ B02：file_write（14 tests）
- ✅ B03：shell_exec（14 tests）
- ✅ B04：glob_match + grep_search（16 tests）
- ✅ B05：string_replace + sort_by + take_first + counter（30 tests）
- ❌ B06：条件计算 op 族（**已废弃**，原 12 op 删除——详见 dev-log/2026-08-20-evaluate-expr-redesign.md）
- ✅ B07：evaluate_expr 重构（48 tests）⭐

**Phase B 净变化**：22 个 L2 op → **11 个 L2 op**（减少 50%）。条件判断 DAG 长度 5-6 → 1。

**Phase B 累计测试**：485/485 passing（27 文件），类型检查通过，全局覆盖率 96.58% lines。

> **2026-08-20 错误模型修订**：原"已知错误 vs 硬错误二分 + propagateHardError"已废弃。
> 新模型：错误处置权在 L3（handleError 标志）——L3 编译的指令带标志决定异常是否本层处理，
> 无标志默认由 L1 递归向上冒泡（详见 doc 10 §三.8/§三.9 与 dev-log/2026-08-20-a10.md）。

### 设计反馈原则（重写过程遵循）

1. **架构偏离 → 立即重写**：不留技术债务
2. **重写有文档**：FDR 记录（dev-log/2026-08-20-design-feedback-major-rewrite.md）
3. **测试先行**：重写前先确保新设计可测试
4. **类型驱动**：用 TypeScript 类型系统强制约束（如 FormalParam.register 必填）
5. **覆盖率作为反思工具**：不走火入魔追求100%，但用覆盖率触发设计问题反思
6. **防御代码有文档**：在代码位置加注释说明为什么不测试（`/* v8 ignore next */` + 详细解释）