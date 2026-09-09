<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# execute-intent 单元测试图谱（PlantUML 版）

本目录为 execute-intent 的 20 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

```
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
```

## 20 个测试一览

| # | 目录 | test() 名称 | 类型 | 视图 | 子图 |
|---|------|------------|------|------|------|
| 1 | [01-basic-frame-retention](./01-basic-frame-retention/) | 调用 L3.compile，children 压入帧之上（帧保留） | positive | stack | — |
| 2 | [02-children-order](./02-children-order/) | children 压栈顺序：children[0] 在栈顶（先执行） | positive | stack | — |
| 3 | [03-empty-children](./03-empty-children/) | 空 children：帧保留，无子指令 | positive | stack | — |
| 4 | [04-l3-compile-args](./04-l3-compile-args/) | L3 compile 接收 intent 和 state 参数 | positive | stack | — |
| 5 | [05-phase-awaiting-children](./05-phase-awaiting-children/) | pending → awaiting_children（done 由主循环收尾） | positive | stack | — |
| 6 | [06-phase-types](./06-phase-types/) | phase 字段类型正确（4 种） | positive | stack | — |
| 7 | [07-l3-throw-upward](./07-l3-throw-upward/) | L3 抛错时向上传播，不被 catch | negative | stack | — |
| 8 | [08-empty-vs-throw](./08-empty-vs-throw/) | L3 返回空 children 与抛错是不同路径 | negative | stack | — |
| 9 | [09-handleerror-required](./09-handleerror-required/) | handleError 是必填字段 | positive | stack | — |
| 10 | [10-handleerror-false-bubbles](./10-handleerror-false-bubbles/) | 默认语义：false = 异常向上冒泡 | positive | stack | — |
| 11 | [11-route-by-type](./11-route-by-type/) | 按 type 路由到不同 children | positive | stack | — |
| 12 | [12-unregistered-type](./12-unregistered-type/) | 未注册的 type 路由返回空 children | negative | stack | — |
| 13 | [13-dag-if-then-else](./13-dag-if-then-else/) | DAG if-then-else 编译产物正确压栈 | positive | stack | [dag-stacking.puml](./13-dag-if-then-else/subfigures/dag-stacking.puml) |
| 14 | [14-nested-frame](./14-nested-frame/) | 嵌套 L3.compile 调用链（帧嵌套） | positive | stack | — |
| 15 | [15-state-preserve-publicstore](./15-state-preserve-publicstore/) | 不动 publicStore | neutral | stack | — |
| 16 | [16-state-preserve-internalstore](./16-state-preserve-internalstore/) | 不动 internalStore | neutral | stack | — |
| 17 | [17-state-preserve-allocator](./17-state-preserve-allocator/) | 不动 allocator | neutral | stack | — |
| 18 | [18-entry-basic-fields](./18-entry-basic-fields/) | id / parentIntentId / createdAt | positive | stack | — |
| 19 | [19-entry-intent-fields](./19-entry-intent-fields/) | intent 字段：type + params | positive | stack | — |
| 20 | [20-error-identity](./20-error-identity/) | 是 Error 子类 | neutral | stack | — |

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

- 表格版单元测试清单：[`../execute-intent-unit-tests.md`](../execute-intent-unit-tests.md)
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[`../../../../tests/phase-a/tier-a08-execute-intent.test.ts`](../../../../tests/phase-a/tier-a08-execute-intent.test.ts)

## 渲染方式

```bash
plantuml -recursive execute-intent-unit-test-diagram/
```
