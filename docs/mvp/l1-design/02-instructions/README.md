# L1 指令集参考（5 primitive）

本文档集逐条阐述 L1 的 5 个 primitive——结构定义、用途、预期执行效果，以及每个指令可穷举的全部合法格式与示例。

| 文件 | 指令 |
|---|---|
| [move.md](./move.md) | `move` — 数据搬运 |
| [execute-op.md](./execute-op.md) | `execute_op` — 调用一个已注册的 L2 Operation |
| [execute-intent.md](./execute-intent.md) | `execute_intent` — 触发一次 L3 compile，压入一整层 children |
| [skip-n.md](./skip-n.md) | `skip_n` — 无条件跳转 |
| [conditional-skip.md](./conditional-skip.md) | `conditional_skip` — 条件跳转 |

## 单元测试清单（按 primitive 分目录）

每篇只收录**纯单元级**测试——直接对应当前 primitive handler 函数本身、不经过 main-loop/L3 compiler 间接驱动的用例。跨 primitive 协作或经由完整 DAG/IntentEntry 流程触发的场景归入集成层（phase-b/c/d/e），不在这些文件范围内。

进入下列 5 个图谱目录之一查看详细用例与图形注释：

- [`move-unit-test-diagram/`](./move-unit-test-diagram/) — 16 个用例（含 4 个子图）
- [`skip-n-unit-test-diagram/`](./skip-n-unit-test-diagram/) — 22 个用例（含 1 个子图）
- [`conditional-skip-unit-test-diagram/`](./conditional-skip-unit-test-diagram/) — 31 个用例（含 1 个子图）
- [`execute-op-unit-test-diagram/`](./execute-op-unit-test-diagram/) — 25 个用例
- [`execute-intent-unit-test-diagram/`](./execute-intent-unit-test-diagram/) — 20 个用例（含 1 个子图）

每个图谱目录的顶层 README.md 列出该 primitive 的全部测试用例与主图/子图链接；每个测试用例的子目录含 PlantUML 主图、详细 README.md，必要时含 `subfigures/` 子图——用例 README.md 承担**测试场景、验证点、设计决策**等详细解释职责。

> ✅ **状态说明**：五篇均已与对应 `tier-a*.test.ts` 源文件逐条核对完成，覆盖率 = 100%（16 / 22 / 31 / 25 / 20 = 合计 **114 条 test()**，全部入表）。所有 main.puml 已通过 `scripts/check-plantuml.sh` 验证语法（**121/121 通过**）。

每条文档都以 `src/l1/types.ts` / `src/l1/primitives/*.ts` 当前实现为准；若与更早的设计稿描述冲突，以源码 + 本文件夹为权威源。

## 共同的结构性背景（五篇共享前提）

- 每一条指令都是 `StackEntry` discriminated union 的一个成员，都携带公共字段 `{ id, parentIntentId, createdAt }`，加上各自的 kind-specific payload。L1 main loop 每次只处理栈顶一条 entry。
- "弹出 self" 指把这条正在处理的 entry 自己从 `state.stack` 移除——这是所有 primitive 的默认收尾动作之一（少数情况见各篇单独说明）。
- 涉及寄存器/存储地址的内容统一用 `Address`（3 种 kind：literal / public / internal；原先还有第 4 种 file 现已移除，详见 move.md），完整定义见 [../01-architecture-overview.md §二](../01-architecture-overview.md)，本篇不重复展开。
