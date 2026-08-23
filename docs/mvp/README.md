# MVP 项目文档

> 基于 pi coding agent 构建分层语义翻译系统的完整讨论记录与结论

## 文档索引

| 文件 | 内容 |
|---|---|
| [01-discussion.md](./01-discussion.md) | 完整讨论记录（从 4 个基础能力到 MVP 范围） |
| [02-translation-layer-hypothesis.md](./02-translation-layer-hypothesis.md) | 翻译层假说：为什么"一切都是 X"会遇到边界 |
| [03-layered-architecture.md](./03-layered-architecture.md) | 分层翻译架构：意图识别 → 编译 → 完整性分析 → 执行 |
| [04-mvp-scope.md](./04-mvp-scope.md) | MVP 五大核心能力 + 推迟项 + 基础设施 |
| [05-implementation-roadmap.md](./05-implementation-roadmap.md) | 实施路线图与决策树 |
| [06-execution-layer.md](./06-execution-layer.md) | 执行层设计：三层 RISC-微代码-意图 架构（L1 硬件 + L2 微代码 + L3 指令序列） |
| [07-intent-library.md](./07-intent-library.md) | 意图库与 DAG：从自然语言到 L1 的完整路径（自顶向下视角） |
| [08-environment-context.md](./08-environment-context.md) | 环境上下文（Environment Context）：会话级、持久化的环境元数据，与 AI 行业"context"刻意区分 |
| [09-l1-implementation.md](./09-l1-implementation.md) | L1 实现设计：Runtime、Operation 注册、动态加载（TypeScript MVP） |
| [10-reactive-execution-model.md](./10-reactive-execution-model.md) | 响应式执行模型：L1 调度器 + 异构指令栈 + 错误处理即 StandardIntent |
| [11-prototype-implementation-plan.md](./11-prototype-implementation-plan.md) | 原型实现计划：28 个 tier / 5 个 Phase（A-E）+ 迭代协议（Gate 检查点 / FDR / 重写协议） |
| [12-experience-model.md](./12-experience-model.md) | L3 经验（Experience）模型设计响应：pre-processing + conditional-judgment + target-op 三段式（2026-08-20 新增） |
| [19-register-file-core.md](./19-register-file-core.md) | **核心需求文档（Draft v0.1，2026-08-21）**：寄存器文件重设 CRR——必须支持的 5 项能力基线（C1–C5）+ 关键预期与不变量 K1–K5（多请求隔离 / 串行 CALL 无真并发 / U_max≈76 含深度线性叠加且由 maxConcurrentScopes≤8 钉死 / scope prefix = 逻辑独立≠物理 reclaim / publicStore 是平行增长通道）+ 明确不做 N1–N6 + P0 评审 checklist |
| [19b-register-design.md](./19b-register-design.md) | **详细设计文档（Draft v0.1，2026-08-21，待评审）**：达成 C1–C5 的实现方案——R5.x/R6.x 子项、数据结构变更、编译器伪代码、Walkthrough、P0–P4 分阶段计划与风险清单 |
| [19c-implementation-plan.md](./19c-implementation-plan.md) | **实施计划（Draft v0.1，2026-08-22）**：CRR P0–P4 任务分解（T-0.1–T-4.4 共 21 task）+ 依赖图（DAG + critical path ~13d）+ 反向追踪矩阵（design §七 R-x ↔ owner task 关闭标记）+ 分阶段回滚策略 + doc 同步 checklist owner 归属 |

## 实现状态（2026-08-21，更新）

原型代码在 [mvp-prototype/](../../mvp-prototype/)（独立 git 仓库）：

- ✅ Phase A+B+C+D+E 全部完成（**571 tests/33 files 全过**，含真实 L2 ops + ExperienceService E2E + MockL4 pipeline）
- 📍 当前坐标：MVP 收官态。下一步见 [doc 13 后续方向](./13-next-directions.md)，其中「寄存器文件重设（CRR）」已独立成 doc 19 核心需求 + doc 19b 详细设计（2026-08-21 新增，针对 internalStore 无界增长/A→B register 引用缺失等 D-C6-1/D2/T4 遗留问题的一次阶段性重构基线）
- ✅ 双区架构重写：`publicStore`（业务）+ `internalStore`（寄存器）+ `RegisterAllocator`
- ✅ 错误体系：`OperationError`（L2 已知错误 → `$r_err`）+ `AddressError.code`（L1 错误分类）
- ✅ 覆盖率：100%（含 v8 ignore 标记的防御代码）
- 🔄 **设计哲学重大调整（2026-08-20）**：L3 从"DAG 节点"模型转为 **Experience 三段式模型**
   - pre-processing + conditional-judgment + target-op
   - skip-cost 参数（0-100 浮点）控制跳过必要性
   - 经验间通过调用关系形成 DAG
   - 详见 [doc 12-experience-model.md](./12-experience-model.md)
   - Phase C 计划从 5 tier 调整为 7 tier（从最简单逐步扩展）
- 📍 当前：239+ 测试通过，下一步 A8（execute_intent）需使用新 L3 接口

## 一页纸结论

**核心问题**：在 LLM agent 系统中，"自然语言意图 → 操作指令"的完整翻译是否可行？

**结论**：完整翻译不可能（意图空间开放），但**对于封闭意图子集**可以接近确定性翻译。

**方案**：基于 pi 的扩展机制，构建 5 层架构：
1. **意图识别**（LLM，封闭意图枚举）→ 见 [07-intent-library.md](./07-intent-library.md) 的 L4 层
2. **基础指令 Primitives**（小而正交的执行词汇）→ 见 [06-execution-layer.md](./06-execution-layer.md) 的 L1 + L2 + L3
3. **上下文追踪**（项目状态、用户历史）→ 见 [08-environment-context.md](./08-environment-context.md)
4. **意图编译**（规则驱动，Intent → Instruction 序列）→ 见 [07-intent-library.md](./07-intent-library.md) 的 DAG 解析
5. **完整性分析 + 补全交互**（参数缺口检测 + 用户澄清）

**执行模型**（响应式）：
- **L1 是 5-primitive 调度器**（不是执行器），通过异构指令栈调度 L2/L3
- **L3 是被调用的 service**（不是编译阶段），按需分解意图一层
- **L1 5 primitive**：`move` / `execute_op` / `execute_intent` / `skip_n` / `conditional_skip`
- **错误处理走 DAG 条件分支**（业务逻辑）+ **L1 异常冒泡**（处置权在 L3 handleError 标志）
- **循环支持**：通过**递归 intent 引用** + `conditional_skip`实现，不增加 `loop` primitive
- 完整定义见 [10-reactive-execution-model.md](./10-reactive-execution-model.md)

**多视角**：
- 自底向上：[06-execution-layer.md](./06-execution-layer.md) 定义执行层（L1/L2/L3 词汇表）
- 自顶向下：[07-intent-library.md](./07-intent-library.md) 定义完整路径（NL/L4/L3/L2/L1）
- 执行语义：[10-reactive-execution-model.md](./10-reactive-execution-model.md) 定义 L1 调度器 + 异构指令栈
- 横向：[08-environment-context.md](./08-environment-context.md) 定义会话级环境元数据
- 实现层：[09-l1-implementation.md](./09-l1-implementation.md) TypeScript Runtime 实现

**策略**：渐进式扩展 pi（扩展 → SDK → 必要时 Fork），不要重新设计。

## 关键原则

1. **MVP 不追求完整性，追求可测试的最小核心**
2. **基础设施（测试、版本、可观测性）和能力同等重要**
3. **明确推迟"做不了"的部分，写进失败模式目录**
4. **保持每个能力独立可替换**——为长期演进留空间
5. **变化的与稳定的部分清晰分离**：编译规则/UI 会变；Primitives/完整性分析逻辑长期稳定