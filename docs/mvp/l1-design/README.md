# L1 设计文档集（权威源）

L1（执行层调度器）的**落地后现状**权威描述，独立于 [06-execution-layer.md](../06-execution-layer.md) / [10-reactive-execution-model.md](../10-reactive-execution-model.md) 等早期设计稿。这些设计稿记录的是各阶段的设计推演过程与历史修订轨迹，本文档集只关心「当前代码实际是什么样」。

| 文件 | 内容 |
|---|---|
| [01-architecture-overview.md](./01-architecture-overview.md) | **架构总览**：双数据区、异构指令栈、与 L2/L3 的关系、指令风格特征（RISC 类比）。不展开单条指令定义与寄存器 slotIndex 细节 |
| [02-instructions/](./02-instructions/) | **L1 5 primitive 指令集参考**：move / execute_op / execute_intent / skip_n / conditional_skip，每条一篇独立文档——结构定义、用途、预期执行效果、可穷举格式示例 |

## 规划中（尚未编写）

| 计划编号 | 主题 | 说明 |
|---|---|---|
| （并入 [`02-instructions/`](./02-instructions/)）剩余部分 | L2 builtin operation 全集逐条参考 | file_read/file_write/string_replace/shell_exec/glob_match/grep_search/evaluate_expr/evaluate_collection/increment_counter/decrement_counter 逐个列出 formalSpec(inputs/outputs businessName+slotIndex)，与 `scripts/dump-formal-spec.ts` 输出对齐，避免手维护漂移；5 primitive 自身部分已在上面的文件夹内完成，待补的是各 op 的字段级清单 |
| `03-register-file.md` | CRR 落地后的寄存器架构现状 | FrameScopeAllocator / scope prefixing (`$S<scope>.in<k>`/`out<k>`) / `$err`·`$path` 全局功能寄存器 / publicStore persist channel / feature flag `useFixedSlotConvention` 当前默认值与 P4 删除计划。与 [../19b-register-design.md](../19b-register-design.md)（设计稿）互为「设计 vs. 实现」对照 |
| `04-error-handling.md` | 异常冒泡 + handleError 处置权在 L3 | bubbleError/abortFrame 对称性约束(R-1)、DAG catch 逻辑、OperationError 结构 |

## 与其他文档的关系

- **本文档集只描述 L1**：L2 operation 的业务行为细节仍见各 op 的源码注释与其所在层级文档；L3 Experience 模型本身（DAG/if-then-else/registerOutput 引用规则）见 [../18-xml-to-l3-compiler.md](../18-xml-to-l3-compiler.md)。
- CRR（register file redesign）的**需求基线与设计推演**仍在顶层编号文档 [../19-register-file-core.md](../19-register-file-core.md) / [../19b-register-design.md](../19b-register-design.md) / [../19c-implementation-plan.md](../19c-implementation-plan.md)，本文件夹未来的 `03-register-file.md` 是对它们的「已落地现状摘要 + 偏差记录」，不重复完整推导过程。
