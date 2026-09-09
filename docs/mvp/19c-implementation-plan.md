# CRR 实施计划（CRR — Implementation Plan & Task Decomposition）

> **状态**：Draft v0.1（待评审）
> **日期**：2026-08-22
> **源文档**：核心需求 [doc 19](./19-register-file-core.md)、详细设计 [doc 19b](./19b-register-design.md)、路线图 [doc 13](./13-next-directions.md) D-C6-1/D2/D3/D4/D5
> **本文档回答什么**：将 [doc 19 §阶段切分概览](./19-register-file-core.md#阶段切分概览详细设计见-doc-19b) 的 P0–P4 进一步拆解为**可分配、可验证、可回滚的工程任务**，说明每个 task 的前驱/后继依赖、是否可并行、与设计文档 §x 的对应关系、合并/拆分的依据；并提供一张总览表 + 风险 → 任务反向追踪矩阵（design §七 R-x ↔ task id）。

---

## 阅读指南

- §一 总体策略（feature flag / branch 策略 / 里程碑 commit 节点）
- §二 阶段切分总览表（P0–P4 → Task ID / 依赖 / 验收 / 预估工作量）
- §三 详细任务分解（每个 Task ID 的：输入/输出/前置/后置/风险编号 R-x/对应测试用例 T-xx）
- §四 依赖图（DAG）+ 并行建议
- §五 反向追踪矩阵（design §七 R-1..R-5 + 核心 doc 19 checklist → 哪个 task 关闭它）
- §六 风险与回滚（每个 Phase 的回滚点 + 全量回滚触发条件）
- §七 文档同步 checklist（doc 19b §八 → 哪个 phase 完成哪些 doc 同步）

---

## 一、总体策略

### 1.1 Feature flag + 双模式共存

- 入口：[compiler.ts](../../src/l3/compiler.ts) 顶层 `useFixedSlotConvention:boolean`（默认 **false** = P0 评审期 + P1 完成前的旧行为；P1 末 legacy 对照通过后翻 **true**；P4 末删除旧路径）
- 旧路径（`useFixedSlotConvention=false`）：`expandRefs` 维持 `$r_argtmp_N` 自增、`makeNestedIntent` 对 register kind 仍 throw、`$r_err/$r_path` 旧名引用、evaluate_expr env map 走 `?? name` fallback —— **与 P0 评审前完全等价**，便于逐 phase diff review + e2e 对照
- 新路径（`useFixedSlotConvention=true`）：FrameScopeAllocator、formalSpec.slotIndex、scope prefixing、literal/judge pool round-robin、$err/$path 重命名

### 1.2 分支 / commit 策略

```
master ── P0评审 ─┬─ P1 ─┬─ P2 ─┬─ P3 ─┬─ P4 (legacy mode 删除 + doc 冻结)
                  │      │      │      │
                  └─每个 Phase 独立 mergeable PR,自带
                     1. feature flag 双值跑过 e2e 的两条 CI job
                     2. phase-specific assertion 增加 (K3 size ceiling / T-C1 register ref 等)
                     3. doc 同步 (Phase 自己负责的 doc 19b §八条目)
                     4. risk 反向追踪表 R-x ↔ task 关闭标记 (本计划 §五)
```

### 1.3 工作量估算口径

| 单位 | 含义 | 来源 |
|---|---|---|
| **XS** | 单文件 ≤10 行改动 + 单测（典型：常量改名、deprecated alias 加一行） | P1 子任务多数 |
| **S** | 单文件 ≤40 行改动 + 新增 1 个测试文件 ≤3 个 case | T-1.4 / T-2.3 |
| **M** | 跨 2–3 文件 / 新增 ≤80 行 + 新增完整 tier 测试（如 T-C1/T-D1） | T-1.1 / T-2.1 / T-3.1 |
| **L** | 跨 ≥4 文件 / 新增/重写 ≥150 行 + 与既有执行语义交叉（典型：FrameScopeAllocator 替换 RegisterAllocator） | T-1.1 / T-3.2 |

> ⚠️ 估算**不含** legacy mode 对照测试运行时间（CI 跑两次全量 tier-a/b/c/d/e + demos，~5–10 分钟/P0 节点）、不含评审 + 修 round 次数。**每个 phase 至少留 1–2 个 buffer 天处理 review 反馈与回归保护测试补强**。

---

## 二、阶段切分总览表

| Phase | Goal | Task IDs（详见 §三） | 依赖前 Phase | 关键验收（对应 doc 19 §阶段切分概览） | 工作量估算 |
|---|---|---|---|---|---|
| **P0** 评审 | 文档基线 lock-down，确认 U_max/M_max/P_max 初判值、FormalParam schema 迁移影响范围、shell_exec outputs 拆分决策；feature flag 入口占位（默认 false 即可） | T-0.1, T-0.2, T-0.3 | — | (1) doc 19 + 19b 评审通过；(2) §五反向追踪矩阵每条 R-x 至少有一个 owner task | 评审本身 = 1–2d；T-0.1–0.3 = XS×3 |
| **P1** FrameScopeAllocator + formalSpec.slotIndex + R6a pool + C4 改名 | scope prefixing 落地（C3 本体）；literal/judge-cond pool round-robin（C1 有界）；$err/$path 改名（C4）；D-3 RegisterAllocator 复活、D-5 env map 显式填充 | T-1.1, T-1.2, T-1.3, T-1.4, T-1.5, T-1.6 | P0 | `internalStore.size() ≤ U_MAX_P1`；tier-a/b/c/d/e legacy 对照全绿后翻 `useFixedSlotConvention=true`；demo-06 diff review（仅 Address.name 字符串变化、语义不变）；T-A1/T-A2/T-A3/T-E1/T-E2 通过 | L + S + S + XS + S + S ≈ **2–3d** 主开发 + 1d 对照测试 |
| **P2** outputs_bindings materialization + C5 persist hook + pipeline.collect 去硬编码 | post-bindings Step5 move 生成；publicStore 首个真实落地点（safe_write/read_file_with_default）；pipeline.ts PRIMARY_OUTPUT 硬编码 Record 替换为读 exp.outputs_bindings | T-2.1, T-2.2, T-2.3, T-2.4 | P1 | `safe_write.bytes_written` / `read_file_with_default.content` publicStore entry 出现；未声明 bindings 的经验不污染 publicStore（T-B2 通过）；resolveResponse P2 起从 $path+bindings 反查模板 | M + S + S + M ≈ **2–3d** |
| **P3** register 引用 in nested params（C2 本体）+ 编译期类型校验 | ParamRef.kind:'register' 正式 support 结构化 `{exp?,outKey}`；B.bindInputs 生成 deferred binding move；compile-time type mismatch 检测（T4 联动 ParamSpec.type） | T-3.1, T-3.2, T-3.3, T-3.4 | P2 | demo-06 A.file_read.output.content → B.string_replace.input.text 真实传值；T-C1/T-C2/T-C3 通过；K4a T-D1/T-D2/T-D3 通过；C1 size ceiling 不因新增嵌套深度突破 | L + M + S + XS ≈ **3–4d** |
| **P4** 收尾（可选） | R6b const table（如实测需要）/ U_MAX 实测固化 / legacy mode 删除 / deprecated alias 清理 | T-4.1, T-4.2, T-4.3, T-4.4 | P3（且 P1–P3 各 phase e2e 在 legacy 对照模式下全绿过至少 1 个 sprint） | U_MAX_P1/P2/P3 实测值替换估算值写入 doc 19 N4；`rg '\$r_input_\|\$argtmp_\|PRIMARY_OUTPUT' -- src` 清零；`useFixedSlotConvention` 配置项移除（默认值 hardcode 为 true）；errors.ts/response.ts/main-loop.ts import 源切换为 GLOBAL_ERR/$path | S + S + S + XS ≈ **1–2d** |

> **总投入估算**：约 **10–14 个工作日** 主开发 + **3–5d** 评审/review/对照测试调试 buffer。**可压缩点**：P3 推迟（如 doc 13 旧 D2 缓行标注保持到 v0.3+）；**不可压缩点**：P1 是 C1 有界的本体，离开 P1 → C2/C3/C4/C5 全部失去落点。

---

## 三、详细任务分解

> **格式**：每个 Task = {输入/输出/前置/后置/对应 design §x / R-x / T-x / 估算}
> **命名空间**：`T-<phase>.<seq>` （如 T-1.3 = Phase 1 第 3 个任务）；R-x = doc 19b §七 风险编号；T-x = doc 19 测试场景清单编号

### P0 — 评审基线（3 task，XS×3）

#### T-0.1 — 跑 `L2Registry.list()` formalSpec dump，作为 doc 19 P0 checklist ②/⑤ 的客观证据
- **输入**：[src/l2/registry.ts](../../src/l2/registry.ts) + 9 条 [experience-library.ts](../../src/l3/experience-library.ts) formalSpec
- **输出**：console.log 表附入 doc 19b §三 U_max 核算旁证；M_max=4 / P_max=3 / U_max≈76 三常量定稿（接受或调整）
- **前置**：—
- **后置**：T-1.1 / T-1.2 可以直接以这些常量为约束设计 FrameScopeAllocator
- **风险**：R-?（新发现）/ 关联 T-xx：T-A1–T-A3 都需要这些常量
- **估算**：XS（含文档录入）

#### T-0.2 — FormalParam schema 迁移影响范围扫描
- **输入**：[src/l2/operation.ts](../../src/l2/operation.ts) `FormalParam.register: string` 所有引用点 + demo/测试若直接读 .register 字段
- **输出**：grep 结果表（影响文件数 + 是否需要同步迁移断言）+ 评审确认 schema 变更可接受
- **前置**：—
- **后置**：T-1.2 schema 改造有 migration 路径
- **风险**：R-?（最大潜在返工点 / doc 19 P0 checklist ③ 已标注）；关联 T-C3（type 字段防丢失）
- **估算**：XS

#### T-0.3 — compiler.ts `useFixedSlotConvention:boolean` 占位入口
- **输入**：当前 compiler.ts 入口签名
- **输出**：新增参数（默认 false，行为与今日完全等价）+ 一处分支占位（`if (useFixedSlotConvention) { /* new path */ } else { /* legacy */ }`，new path 内 `throw new Error('CRR not yet implemented in P0')`，仅做编译期占位）
- **前置**：—
- **后置**：P1 第一个 task T-1.1 直接填充 new path
- **风险**：R-2（feature flag 策略，design §七）
- **估算**：XS

### P1 — FrameScopeAllocator + scope prefixing + R6a + C4（6 task，含 1 L 主任务）

#### T-1.1 — FrameScopeAllocator 替换 RegisterAllocator（核心 L 任务）
- **输入**：doc 19 C3；doc 19b §五 R5.2/R5.3；[src/l1/execution-state.ts](../../src/l1/execution-state.ts) 现有 RegisterAllocator 实现
- **输出**：新 `FrameScopeAllocator` 类（methods: `enterScope()` / `exitScope()` / `nextInSlot(businessName)` / `nextOutSlot(businessName)` / `allocateArgtmpSlot()` / `allocateJudgeScratch()`），持 scope stack（Frame[] = {frameId, allocated: Set<string>}），`maxActiveScopes` 默认 8 软限（与 A11 [RecursionDepthError](../../src/l1/recursion.ts) 并列检查）；enterIntent / exitIntent 调用点（T-1.5 负责挂 hook）保持原位
- **前置**：T-0.1（常量定稿）/ T-0.3（feature flag）
- **后置**：T-1.2 / T-1.3 / T-1.4 都依赖此 allocator 提供的 scope prefix 字符串
- **风险**：**R-1🔴高**（scope pop/bubbleError abortFrame 对称性）— 本 task 必须自带单元测试覆盖 ① 正常 pop ② error 路径 abortFrame pop ③ retry-until-success 嵌套 A→B→A 第二次 B pop 时 frameId 不泄漏计数器
- **关联 T-xx**：T-A1（基线零值）/ T-A2（深度 8 软限触发）
- **估算**：L（≥4 文件 × ~30 行 + 单测 5–8 case）

#### T-1.2 — `formalSpec.slotIndex:number` schema 改造 + FormalParam.register 改为 `@deprecated` alias
- **输入**：T-0.2 扫描结果；doc 19 §评审 checklist ③
- **输出**：[src/l2/operation.ts](../../src/l2/operation.ts) `FormalParam { businessName, slotIndex:number, type, required, description }`；旧 `register:'$r0'` 字段保留但标 `@deprecated`（P4 由 T-4.3 删除）；L2Registry 9 条 op formalSpec 全部从硬编码字符串迁为 slotIndex
- **前置**：T-0.2
- **后置**：T-1.3 expandRefs 按 slotIndex 拼 Address.name；T-1.4 evaluate_expr 反查靠 slotIndex
- **风险**：R-2（schema 迁移同步所有测试断言 — 必须先 grep 列出所有读取 `.register` 字段的断言并同步迁移）
- **关联 T-xx**：T-C3（type 字段同步迁移，防止 string→number 改造中丢 type 字段）
- **估算**：S（schema 改动 + 9 条 op formalSpec 迁移 + 测试断言同步）

#### T-1.3 — compiler.ts `expandRefs` / `bindInputs` / `compileBranch` 新路径实现（R5.2/R5.3）
- **输入**：T-1.1 allocator；T-1.2 slotIndex；doc 19b §四 R5.2/R5.3 伪代码
- **输出**：当 `useFixedSlotConvention=true` 时：expandRefs 不再分配 `$r_argtmp_N`，改用 allocator.allocateArgtmpSlot()（round-robin pool size=8）；bindInputs 按 op.formalSpec.inputs[k].slotIndex 拼 `$S<scope>.in<k>`；compileBranch 对 judgment expr 走 allocateJudgeScratch（pool size ≤10）
- **前置**：T-1.1, T-1.2
- **后置**：T-1.5 主循环 hook 改造后才能跑通 e2e
- **风险**：R-3🟡中（pool round-robin safety — 必须验证"同 OpEntry.inputs 两个 literal 先后 dispatch 时 pool[k] 被后续 move 覆盖"的安全性）
- **关联 T-xx**：T-A3（literal sidecar round-robin 旧/新峰值对比）
- **估算**：M

#### T-1.4 — C4 $err/$path 改名 + GLOBAL_FUNCTIONAL_REGS 枚举
- **输入**：[src/l2/errors.ts](../../src/l2/errors.ts) `ERROR_REGISTER='$r_err'`；[src/l4/response.ts](../../src/l4/response.ts) `$r_path` 引用
- **输出**：errors.ts `export const GLOBAL_ERR='$err'`; `export const GLOBAL_PATH='$path'`; `export const GLOBAL_FUNCTIONAL_REGS=['$err','$path']`（≤6 预留位 N6 冻结线）；旧 `ERROR_REGISTER` 标 `@deprecated`（P4 T-4.3 删除）；response.ts/bubbleError/main-loop import 源切换
- **前置**：—
- **后置**：T-3.2 P3 register 引用落地后，bubbleError 读 `$err` 行为不变（C4 验收）
- **风险**：R-2（import 源切换覆盖完整 — 必须 rg 全库搜）
- **关联 T-xx**：T-E1（T-1.6 配套验收）
- **估算**：XS–S

#### T-1.5 — main-loop.ts enterIntent/exitIntent 挂 FrameScopeAllocator hook
- **输入**：T-1.1 allocator；T-1.3 compiler 新路径产物
- **输出**：[src/l1/main-loop.ts](../../src/l1/main-loop.ts) executeIntent / executeOp 入口前调用 `state.allocator.enterScope(scopeId)`，done+pop 时 `exitScope()`；bubbleError 路径的 abortFrame 必须同步 exitScope（R-1 关键对称点）
- **前置**：T-1.1, T-1.3
- **后置**：T-1.6 e2e 在新路径下跑通
- **风险**：**R-1🔴高**（对称性，本任务是最易运行时打破 U_max 上界的运行时通道）
- **关联 T-xx**：T-A1（基线验证 scope pop 不泄漏）/ T-A2（深度压测）
- **估算**：S（改动小但 R-1 风险高，需独立 PR review）

#### T-1.6 — evaluate_expr env map 显式填充（D-5 修复）
- **输入**：T-1.4 GLOBAL_FUNCTIONAL_REGS；[src/l2/builtins/evaluate-expr.ts](../../src/l2/builtins/evaluate-expr.ts) 现有 `ctx.env[name] ?? name` fallback
- **输出**：compiler Step4 (condition_expr var.name) → resolveSlotFor(businessName/slot) → env map 显式填充 `{'$r_err':'$err', ...}`；fallback 保留但打 console.warn（design §五 R-5🟡中：存量 9 条经验手写业务名 review 窗口从 P1 初值逐 phase 递减到 P4 = 0）
- **前置**：T-1.4（$err 重命名先落地，env map 才能填对键）
- **后置**：—
- **风险**：R-5🟡中（存量 condition_expr 手写业务名迁移期可观测性）
- **关联 T-xx**：T-E1 / T-E2（含负例："故意保留旧写法 → warning 触发 + 结果仍正确 → 再删除该 case"）
- **估算**：S

### P2 — outputs_bindings + C5 persist + pipeline 去硬编码（4 task）

#### T-2.1 — Experience schema 新增 `outputs_bindings: Record<string, BindingSpec>`
- **输入**：doc 19 C5；doc 19b §三 R5.4；[src/l3/experience.ts](../../src/l3/experience.ts)
- **输出**：新增可选字段 `outputs_bindings?: { [key: string]: { register: string; type: ValueType; persist?: boolean /* default false */ } }`；existing 9 条经验全部默认不声明（保持 MVP D-T1 双区隔离）
- **前置**：T-1.4（$err/$path 重命名先完成，bindings.register 命名空间清晰）
- **后置**：T-2.2 compiler 读取此字段；T-2.3 safe_write/read_file_with_default 显式声明 bindings
- **风险**：R-4🟢低（schema 演进 — P2 引入新 optional 字段，老 client 不破，向后兼容）
- **关联 T-xx**：T-B2 / T-D1 反向断言
- **估算**：XS–S

#### T-2.2 — compiler.ts post-bindings Step5 生成 `move($S_A.outK → publicStore['<expId>.<key>'])`
- **输入**：T-1.3 / T-1.5（新路径 compiler + allocator）；T-2.1 schema
- **输出**：compileExperience 末尾追加一个"收尾 move generation pass"：遍历 exp.outputs_bindings，按 persist:true 标记的 entry 生成一条 OpEntry move，target = publicStore，key = `${exp.id}.${outKey}`；**未声明 / persist:false 不生成 move**（T-B2 / V3 反向断言保护）
- **前置**：T-1.3, T-1.5, T-2.1
- **后置**：T-2.3 e2e 验证 publicStore entry 出现
- **风险**：R-4🟢低（开发者误把 chain-intermediate 标 persist:true → 污染 K5 growth channel）— **本 task 内置静态检查**：若 exp.outputs_bindings 中某个 key 的 register 引用的是某 step 的**非 outputs** 而是 intermediates（compile-time 拒绝）？或允许但 doc 显式警示？本 task 决策需记录
- **关联 T-xx**：T-B2 / T-D1
- **估算**：M

#### T-2.3 — safe_write / read_file_with_default 加 outputs_bindings 显式声明（P2 首个真实落地点）
- **输入**：T-2.2 move generation pass
- **输出**：[src/l3/experience-library.ts](../../src/l3/experience-library.ts) safe_write.outputs_bindings = `{ bytes_written: { register: '$r_bytes', type: 'number', persist: true } }`；read_file_with_default.outputs_bindings = `{ content: { register: '$r_content', type: 'string', persist: true } }`
- **前置**：T-2.2
- **后置**：T-2.4 pipeline.collect 去硬编码后能读到这些 entry
- **风险**：—
- **关联 T-xx**：C5 验收 / T-D1 反向断言（replace_in_file **故意不** 声明 persist，验证 opt-in 默认 false）
- **估算**：XS（schema 填充）

#### T-2.4 — pipeline.collect 去 PRIMARY_OUTPUT 硬编码 Record<string,string> 表
- **输入**：[src/l4/pipeline.ts](../../src/l4/pipeline.ts#L33-L42) 现有 PRIMARY_OUTPUT 表；T-2.3 真实落地的 publicStore entries
- **输出**：pipeline.collect() 改为遍历 `state.publicStore.entries()`，按 expId.key 提取 + 读 exp.outputs_bindings[key].type 做插值校验（T4 schema-driven contract 首落地）；旧 PRIMARY_OUTPUT Record 删除
- **前置**：T-2.3
- **后置**：—
- **风险**：R-4🟢低（删除硬编码表时若有 type 不匹配现有调用方，需同步迁移）
- **关联 T-xx**：P2 整体验收
- **估算**：M

### P3 — C2 register ref in nested params + 编译期类型校验（4 task）

#### T-3.1 — ParamRef schema 扩展 `kind:'register'` 结构化 `{exp?,outKey}`
- **输入**：[src/l3/experience.ts](../../src/l3/experience.ts) `ParamRef { kind: 'literal'|'input', ... }`；doc 19 C2
- **输出**：`ParamRef { kind: 'literal'|'input'|'register', value?, inputName?, ref?: { exp?: string /* 默认 '*' 当前 frame */; outKey: string } }`；保持向后兼容（kind:literal/input 路径不变）
- **前置**：—
- **后置**：T-3.2 compiler 读取 + T-3.3 type check
- **风险**：R-2（schema 迁移 — 现有 experience-library 里 kind 只有 literal/input，新增 register kind 不破坏旧数据但 compiler 必须新增分支）
- **关联 T-xx**：T-C1/C2/C3
- **估算**：S

#### T-3.2 — compiler.makeNestedIntent / bindInputs 新增 register kind 分支：deferred binding move
- **输入**：T-1.3（新路径 compiler 已支持 fixed-slot）；T-3.1 schema
- **输出**：当 ref.kind === 'register' 时，bindInputs Step0 生成 `makeMove(from = '<expId>.<outKey>' 解析到的 $S_parent.outK, to = $S_child.in<slotIndexOf(k)>)`；父 frame 解析依赖 outputs_bindings 显式声明的 key→register 映射（T-2.1 已就绪）；resolveSlotFor 走 formalSpec.outputs[k].slotIndex 反查
- **前置**：T-1.3, T-2.1, T-3.1
- **后置**：T-3.3 / T-3.4 依赖此 makeMove 产物
- **风险**：**R-1🔴高 联动**（parent frame retention window 必须覆盖 B 的整个生命周期 — T-D2/T-D3 直接验证）；T-D3 编译期静态检查 `expectNoScopeAliasing(aFrame, bFrame)` 也由本 task 提供 helper
- **关联 T-xx**：T-C1（基本传值）/ T-D1/T-D2/T-D3（多子复用）
- **估算**：L（含新增编译期 helper + 测试）

#### T-3.3 — compile-time type mismatch 检测（ParamRefError）
- **输入**：T-3.2；doc 19 §评审 checklist ③（type 字段防丢失）
- **输出**：compileExperience(B) 期间对每个 B.input[k] { kind:'register' }，从 A.props.outputs_bindings[ref.outKey].type 与 B.op.formalSpec.inputs[k].type 比对 → 不匹配 throw `ParamRefError('incompatible type: ${srcType} → ${dstType}')`；同样对悬空 outKey 抛 `'A.<key> not found'`
- **前置**：T-3.2
- **后置**：—
- **风险**：R-2（type 字段防丢失 — 必测）；doc 19 §评审 checklist ③
- **关联 T-xx**：T-C2 / T-C3
- **估算**：S

#### T-3.4 — K4a setup_workspace 扩展用例 e2e
- **输入**：[tests/phase-d/tier-d-scenarios.test.ts](../../tests/phase-d/tier-d-scenarios.test.ts#L195-L243) 现有 setup_workspace（pure literal/input，无 register kind）
- **输出**：新增 T-D1（replace_in_file 五步）/ T-D2（多子串行 CALL 同址源异址目标值一致）/ T-D3（retention window + compile-time aliasing check）三个 case
- **前置**：T-3.2, T-3.3
- **后置**：—
- **风险**：R-1🔴高 联动（T-D2/T-D3 是 R-1 运行时打破通道的直接回归保护测试）
- **关联 T-xx**：T-D1/T-D2/T-D3
- **估算**：S（新增 3 个 case）

### P4 — 收尾（4 task，已完成）

> **P4 完成状态（2026-09-17）**：
> - T-4.1：不需要 R6b const table（实测峰值 12 << 理论上限）
> - T-4.2：U_MAX 实测峰值=12，保留理论上限 8202 为安全 bound
> - T-4.3：legacy mode 已删除，new path 是唯一路径。`$r_*` 寄存器名在 new path 下保持全局（不 scope-prefix），`$r_err`→`$err`、`$r_path`→`$path` 由编译器/resolveVar 解析。`enableCrrNewPath()`/`disableCrrNewPath()` 保留为 no-op shim。
> - T-4.4：本文档同步更新

#### T-4.1 — R6b const table（如 P4 实测需要）✅ 不需要
- **触发条件**：P1–P3 完成后跑 tier-a/b/c/d/e + demos 全量实测 internalStore.size() peak，发现 >U_MAX_P1/P2/P3 估算值 76 且主因是 literal/judge-cond scratch 占比过高
- **结论**：实测峰值 12，远低于理论上限，不需要 const table
- **输出**：无需新增 `$const_0..K` round-robin 池
- **前置**：P3 完成 + 实测数据支撑
- **后置**：—
- **风险**：N4（备选，不阻塞）
- **关联 T-xx**：T-A3（重新跑峰值对比）
- **估算**：S（若启用）

#### T-4.2 — U_MAX 实测固化 ✅ 完成
- **输入**：T-1.6 / T-3.4 全量 e2e 跑完 + trace 收集 internalStore.size() peak per case
- **输出**：实测峰值=12，保留 `U_MAX_P1_ESTIMATE=8202`（MAX_ACTIVE_SCOPES=1024 时的理论上限）为安全 bound；doc 19 N4 记录实测值
- **前置**：P3 完成
- **后置**：—
- **风险**：N4（实测值写入 doc N4 后冻结，P4+ 改需要走 doc 变更流程）
- **估算**：S

#### T-4.3 — legacy mode 删除 + deprecated alias 清理 ✅ 完成
- **输入**：T-4.2（U_MAX 固化 = 冻结线已立）；P1–P3 各 phase 在 legacy 对照模式下全绿过至少 1 个 sprint（feature flag 双值稳定）
- **输出**：
  - (1) `useFixedSlotConvention` 参数仍保留但 `crrNewPathEnabled()` 始终返回 true（hardcode new path）
  - (2) `enableCrrNewPath()`/`disableCrrNewPath()` 保留为 no-op shim（兼容现有测试调用）
  - (3) **`$r_*` 寄存器名在 new path 下保持全局**（不 scope-prefix）——这是 P4 的关键设计决策，支持递归经验（如 count_to）通过 `$r_cur` 跨帧共享状态
  - (4) `$r_err`→`$err`、`$r_path`→`$path` 由 `expandRefs`/`resolveVar` 解析（error output 写 `$err`，path mark 写 `$path`）
  - (5) `compileOp` 为 `evaluate_expr` 注入 env map（与 `compileBranch` 一致），确保 `$r_err` 等变量名正确解析
  - (6) `ExperienceService.compile` 合并 `defaultOptions` 与调用方 `options`（修复 skip_cost 丢失 bug）
- **前置**：T-4.2
- **后置**：—
- **风险**：R-2（清理期残留旧名 import 会导致编译失败或行为偏差 — 必须 grep 严格化）
- **估算**：S→M（实际工作量超出预估，涉及编译器/表达式/测试多方面语义迁移）

#### T-4.4 — doc 同步 checklist 收尾（doc 19b §八）
- **输入**：[doc 19b §八](./19b-register-design.md) "文档同步 checklist" 列表
- **输出**：doc 06 / 10 / 12 / 13 对应章节逐项更新（执行层 / reactive execution model / 等价性 / 路线图 — 用本文档 §七 cross-reference 表确认）
- **前置**：T-4.2（U_MAX 冻结）、T-4.3（legacy 删完）
- **后置**：—
- **风险**：—
- **估算**：S

---

## 四、依赖图（DAG）+ 并行建议

```
T-0.1 ──┐
T-0.2 ──┼─→ T-1.1 ──┬─→ T-1.3 ──┐
T-0.3 ──┘            ├─→ T-1.4 ──┼─→ T-1.5 ─→ T-1.6
                    └─→ T-1.2 ───┘
                                    │
                                    ↓
                            T-2.1 ─→ T-2.2 ─→ T-2.3 ─→ T-2.4
                                              │
                                              ↓
                                    T-3.1 ──→ T-3.2 ─→ T-3.3
                                              │       │
                                              └─→ T-3.4
                                                       │
                                                       ↓
                                            (P3 全量 e2e 数据)
                                                       │
                                            T-4.1 / T-4.2 / T-4.3 / T-4.4
```

### 4.1 可并行窗口

| 窗口 | 可并行任务 | 备注 |
|---|---|---|
| P1 内部 | T-1.4（C4 改名）∥ T-1.5（hook 挂载）∥ T-1.6（env map 显式填充） | T-1.4 不依赖 T-1.1，可早开工；T-1.6 依赖 T-1.4 但可与 T-1.5 并行（不同文件） |
| P2 内部 | T-2.1（schema）∥ T-2.4（pipeline 去硬编码 — 但需要 T-2.3 真实数据） | 严格来说 T-2.4 需 T-2.3 完成；T-2.1 → T-2.2 → T-2.3 串行 |
| P3 内部 | T-3.1（schema）∥ T-3.3（type check helper — 写好测试桩） | T-3.4 依赖 T-3.2 + T-3.3 |
| P4 内部 | T-4.1 / T-4.2 / T-4.3 / T-4.4 均可并行启动 | 但 T-4.4 doc 同步引用 T-4.2 实测值时需后置 |

### 4.2 关键路径（critical path = 不可压缩的最短完工时间）

```
T-0.1 → T-1.1 → T-1.3 → T-1.5 → T-2.2 → T-2.3 → T-2.4
   ↘                                          ↓
     T-3.2 → T-3.3 → T-3.4 → T-4.2 → T-4.3
```

> 评估：~10 个串行工作日 + P0 评审/P1 legacy 对照/P3 demo-06 真实传值校验 各 1d buffer ≈ **13d 主路径**；与 §二总投入估算 10–14d 一致。

---

## 五、反向追踪矩阵（design §七 R-1..R-5 + doc 19 checklist → owner task）

| 风险 / 待办项 | 来源 | Owner task（哪个 task 关闭它） | 验证用例 / 断言 |
|---|---|---|---|
| **R-1🔴高** scope pop/bubbleError abortFrame 对称性 | doc 19b §七 | **T-1.1**（allocator 单测覆盖正常 pop / error pop / 嵌套重入）/ **T-1.5**（main-loop hook 对称性）/ **T-3.2**（parent retention）/ **T-3.4**（T-D2/T-D3 多子引用） | T-A1 基线零值 / T-A2 深度压测 / T-D2 同址源异址值一致 / T-D3 编译期 aliasing check |
| **R-2** feature flag 策略 + schema 迁移同步 | doc 19b §七 + doc 19 §评审 checklist ③ | **T-0.3**（feature flag 占位）/ **T-1.2**（schema 迁移 + 测试同步）/ **T-1.4**（import 源切换 grep 完整）/ **T-4.3**（legacy 删除时 rg 严格化） | T-C3（type 字段防丢失）/ 各 phase PR review 时强制跑 legacy 对照 CI job |
| **R-3🟡中** argtmp pool round-robin safety（"同 OpEntry.inputs 两个 literal 先后 dispatch 时 pool[k] 被后续 move 覆盖"的安全性） | doc 19b §七 | **T-1.3**（expandRefs new path 实现 + 单测）/ **T-1.5**（execute_op resolveInputs 同步性保证 — 无 yield point） | T-A3（旧/新峰值对比 + pool safety 单测） |
| **R-4🟢低** C5 误用 + 持久化反模式 | doc 19b §七 + doc 19 K5 | **T-2.1**（schema opt-in 默认 false）/ **T-2.2**（post-bindings 仅对 persist:true 生成 move）/ **T-2.3**（safe_write/read_file_with_default 显式声明做正面示范） | T-B2 / T-D1（反向断言 publicStore.size()===0 for 未声明的经验） |
| **R-5🟡中** evaluate_expr env map 存量手写业务名迁移期可观测性 | doc 19b §七 | **T-1.6**（console.warn 计数 + P4 归零）/ **T-4.3**（删除 `?? name` fallback 时确保 warn 计数=0） | T-E1 / T-E2（含负例：故意保留旧写法 → warn 触发 + 结果正确 → 删除该 case） |
| **N6** global functional registers 冻结线 | doc 19 N6 | **T-1.4**（GLOBAL_FUNCTIONAL_REGS 数组 ≤8 长度检查 + 文档化冻结流程） | T-1.4 单测：尝试 push 第 9 元素抛错 |
| **N4** R6b const table 不阻塞主线 | doc 19 N4 | **T-4.1**（P4 触发条件 = 实测需要） | 仅在 T-4.2 实测值 >76 主因是 literal/judge-cond scratch 时启用 |
| **N5** 多轮会话/EC 不在 CRR 范围内 | doc 19 N5 | **本文档 §三 P2/P4** 边界声明（不新增 task） | K5 / doc 19 §N5 |
| **K1 失效条件** 跨请求 allocator 共享 | doc 19 K1 | **T-4.3**（删除 module-level 单例潜在引入点） + **T-B1** 测试 | T-B1（两 say() 并发无交叉） |
| **K2 失效条件** 真·并发 fan-out | doc 19 K2 | **T-D2** 注释明确"仅测串行，不测 Promise.all"；超出范围需另立 doc | T-D2 test 注释 + design §五 风险交叉引用 |
| **K3 失效条件** RecursionDepthError 软限移除 | doc 19 K3 | **T-1.1**（maxActiveScopes ≤8 软限作为新约束）+ **T-1.5**（main-loop 入口并列检查） | T-A2（depth=9 触发 / depth=8 正常 + peak ≤ U_MAX_P1） |
| **K5 平行增长通道污染** | doc 19 K5 | **T-2.1 / T-2.2**（opt-in 默认 false + 显式声明） + **T-B2** 反向断言 | T-B2 / T-D1 |
| **doc 19 §评审 checklist ①** U_max=76 是否接受 | doc 19 P0 ① | **T-0.1**（formalSpec dump 给出客观依据） + **T-4.2**（实测固化） | doc 19 P0 review 时确认；T-4.2 后冻结 |
| **doc 19 §评审 checklist ②** M_max/P_max 覆盖 9 条经验 | doc 19 P0 ② | **T-0.1** | doc 19 P0 review 时确认 |
| **doc 19 §评审 checklist ③** FormalParam schema 迁移影响 | doc 19 P0 ③ | **T-0.2** + **T-1.2** + **T-C3** | doc 19 P0 review 时确认 |
| **doc 19 §评审 checklist ④** C5 persist 默认 false | doc 19 P0 ④ | **T-2.1**（schema opt-in 默认）+ **T-B2** 反向断言 | T-B2 |
| **doc 19 §评审 checklist ⑤** shell_exec outputs 拆分 | doc 19 P0 ⑤ | **T-0.1**（formalSpec dump 必须包含 shell_exec 详细 outputs） | doc 19 P0 review 时确认；T-1.1 P_max 调整若需要 |

---

## 六、风险与回滚

### 6.1 每个 Phase 的回滚点

| Phase | 回滚动作 | 触发条件 |
|---|---|---|
| **P0** | 删除 T-0.3 占位（feature flag 默认 false = 与今日完全等价） | 评审未通过 / U_max/M_max/P_max 定稿数据不足 |
| **P1** | `useFixedSlotConvention=false` 关闭新路径（仅保留 legacy）；如 allocator 引入 L1 API 兼容问题，可单独 revert T-1.1 PR | T-A1/T-A2 任一断言失败 OR scope pop 计数器泄漏（R-1🔴高触发） |
| **P2** | feature flag 新增 `useOutputsBindingsMaterialization:boolean`（默认 false）隔离 outputs_bindings move generation pass | T-B2 反向断言失败 OR publicStore 大小失控（K5 污染） |
| **P3** | feature flag 新增 `useRegisterKindParamRef:boolean`（默认 false）隔离 register kind 分支 | T-C1/T-C2/T-C3 任一失败 OR U_MAX 实测值显著 >76（K3 假设被打破） |
| **P4** | legacy mode 删除是不可逆动作 — 必须 P4 前至少 1 个 sprint 在双值下全绿，且 P4 入口前再次跑完整对照 | T-4.2 实测 U_MAX 与估算偏差 > 20%（说明估算口径有误，应重审而不是删除 legacy） |

### 6.2 全量回滚触发条件（任何 Phase 触发即停止 CRR 整条线，回归 doc 13 D-C6-1/D2 缓行标注）

- U_MAX 估算口径被 P1/P2/P3 任一 phase 实测严重突破（>100 且优化空间耗尽）
- R-1🔴高风险在 P1/P3 任一阶段无法在合理时间内稳定复现/防护
- L1 primitive（execute_op/move/address-resolver）需要修改（违反 doc 19 C3 "L1 primitive 零改动"承诺）

### 6.3 全量回滚后的过渡方案

- 保留 T-0.3 feature flag 入口（默认 false）作为永久 fallback
- doc 19 / doc 19b 标 Archive（不删除，作为失败案例供后续 doc 借鉴）
- experience-library 内已声明的 outputs_bindings（T-2.3）改为 `@deprecated` 不生效字段

---

## 七、文档同步 checklist（doc 19b §八 → 哪个 phase 关闭它）

> **填写规范**：每行 = [doc 19b §八 待同步 doc 条目] → [由哪个 task 在哪个 phase 关闭] → [验证方式]

| doc 19b §八 待同步 | Owner task | Phase | 验证 |
|---|---|---|---|
| doc 06 执行层 § 相关章节（fixed-slot convention + scope prefixing + register kind 分支） | T-1.3 + T-3.2 | P1 + P3 | 章节末注：详见 [doc 19c §三 T-1.3 / T-3.2](./19c-implementation-plan.md) |
| doc 10 reactive execution model（U_max≈76 / maxConcurrentScopes≤8 软限） | T-1.1 + T-4.2 | P1 + P4 | P4 实测值替换估算 |
| doc 12 等价性 / legacy mode 对照测试方法论 | T-0.3（feature flag）+ 各 phase PR | P0 + P1–P3 | 每个 phase PR CI 跑双值 |
| doc 13 路线图（D-C6-1/D2 升级为 C2 / D-3 / D-4 / D-5 状态变更） | **本文档 19c 自身** | P0（v1.0 通过评审时同步）+ P4 末 | doc 13 引用 doc 19c 作为实施基线 |
| doc 14 (?) / 其他引用 CRR 术语的 doc | 各 phase owner | 持续 | 全文 grep `register file / scope prefix / \$r_argtmp` 同步更新 |

---

## 八、文档元信息

- **Owner**：TBD（P0 评审通过后指派）
- **关联 Issue / PR**：TBD（与 doc 13 D-C6-1/D2/D3/D4/D5 issue tracker 关联）
- **下次评审触发**：P0 评审 → P1 第一个 PR（merge 时 diff review） → P3 demo-06 真实传值验收 → P4 末 doc 冻结
- **变更控制**：本文档与 doc 19 / doc 19b 同步演进；任何 task 编号、依赖关系、估算工作量调整需在 PR 中显式列出

> **回写 doc 19 入口**：已在 [doc 19 顶部](./19-register-file-core.md) 添加「怎么落地、先后顺序、谁依赖谁见 [实施计划](./19c-implementation-plan.md)」链接；doc 19 状态由 Draft v0 → **v0.2**。