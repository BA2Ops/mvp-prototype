<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# move 单元测试图谱（PlantUML 版）

本目录为 `tier-a04-move.test.ts` 的 16 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

```
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
```

## 16 个测试一览

| # | 目录 | test() 名称 | 类型 | 主图 | 子图 |
|---|------|------------|------|------|------|
| 1 | [01-literal-to-internal](./01-literal-to-internal/) | literal → internal（常量加载到寄存器） | 正面 | ✓ | — |
| 2 | [02-internal-to-public](./02-internal-to-public/) | internal → public（寄存器保存到业务） | 正面 | ✓ | — |
| 3 | [03-public-to-internal](./03-public-to-internal/) | public → internal（业务加载到寄存器） | 正面 | ✓ | — |
| 4 | [04-internal-to-internal](./04-internal-to-internal/) | internal → internal（寄存器重命名） | 正面 | ✓ | — |
| 5 | [05-public-to-public](./05-public-to-public/) | public → public（业务变量重命名） | 正面 | ✓ | — |
| 6 | [06-number](./06-number/) | 数字 | 正面 | ✓ | — |
| 7 | [07-null](./07-null/) | null | 正面 | ✓ | — |
| 8 | [08-array-and-object](./08-array-and-object/) | 数组和对象 | 正面 | ✓ | — |
| 9 | [09-pop-on-success](./09-pop-on-success/) | 成功时弹栈 | 正面 | ✓ | [stack-flow](./09-pop-on-success/subfigures/stack-flow.puml) |
| 10 | [10-no-pop-on-failure](./10-no-pop-on-failure/) | 失败时不弹栈 | 负面 | ✓ | [failure-flow](./10-no-pop-on-failure/subfigures/failure-flow.puml) |
| 11 | [11-internal-source-missing](./11-internal-source-missing/) | source 不存在抛 AddressError | 负面 | ✓ | — |
| 12 | [12-public-source-missing](./12-public-source-missing/) | source public 不存在抛错 | 负面 | ✓ | — |
| 13 | [13-literal-write-rejected](./13-literal-write-rejected/) | 写入 literal 抛错（设计约束） | 负面 | ✓ | — |
| 14 | [14-atomic-on-failure](./14-atomic-on-failure/) | 错误时状态不变（atomic） | 负面 | ✓ | — |
| 15 | [15-chain-literal-r0-r1-public](./15-chain-literal-r0-r1-public/) | 链式：literal → $r0 → $r1 → public | 正面 | ✓ | [chain-sequence](./15-chain-literal-r0-r1-public/subfigures/chain-sequence.puml) |
| 16 | [16-same-target-overwrite](./16-same-target-overwrite/) | 同名寄存器覆盖 | 正面 | ✓ | [overwrite-rounds](./16-same-target-overwrite/subfigures/overwrite-rounds.puml) |

## 主图设计原则

- **简洁**：每个 `main.puml` 控制在 ≤650 字节（与本文档密度同档）
- **object diagram 为主**：before-state → executeMove → after-state 的两对象对比
- **note 解释关键点**：前置条件 / 验证 / 设计决策 三类 note

## 子图使用约定

仅在以下情况添加子图：

1. **栈行为时间序列**（#9 / #10）—— main 图用 object diagram 表达不清 push/pop 时序
2. **多步链式调用**（#15）—— sequence diagram 表达 3 步各自的输入/输出
3. **多轮状态对比**（#16）—— state diagram 表达两轮之间的状态迁移

其余 12 个测试场景用 main.puml 已足够表达。

## 配套文档

- 表格版单元测试清单：[`../move-unit-tests.md`](../move-unit-tests.md)（5 列紧凑表格）
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[`../../../../tests/phase-a/tier-a04-move.test.ts`](../../../../tests/phase-a/tier-a04-move.test.ts)

## 渲染方式

`main.puml` 与 `subfigures/*.puml` 均为标准 PlantUML 源文件，可用以下方式渲染：

```bash
# CLI
plantuml main.puml                          # 单文件
plantuml -recursive move-unit-test-diagram/ # 整棵目录

# VS Code 插件
PlantUML (jebbs.plantuml) 或 plantuml-vs

# GitHub 直接渲染
在 .md 中用 ```plantuml ... ``` 围栏，或 ![]() 引用 .puml（部分平台支持）
```