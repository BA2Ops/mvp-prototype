<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# execute-op 单元测试图谱（PlantUML 版）

本目录为 execute-op 的 25 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

```
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
```

## 25 个测试一览

| # | 目录 | test() 名称 | 类型 | 视图 | 子图 |
|---|------|------------|------|------|------|
| 1 | [01-basic-mock-op](./01-basic-mock-op/) | 调用 mock_op：x → x*2 | positive | register | — |
| 2 | [02-hard-error-throw](./02-hard-error-throw/) | 调用 throwing_op 应抛错（硬错误） | negative | error | — |
| 3 | [03-multi-inputs](./03-multi-inputs/) | 多个 inputs | positive | register | — |
| 4 | [04-multi-outputs](./04-multi-outputs/) | 多个 outputs | positive | register | — |
| 5 | [05-addr-input-literal](./05-addr-input-literal/) | literal input 抛 ExecuteOpError | negative | error | — |
| 6 | [06-addr-input-public](./06-addr-input-public/) | public input 抛错 | negative | error | — |
| 7 | [07-addr-input-file](./07-addr-input-file/) | file input 抛错 | negative | error | — |
| 8 | [08-addr-output-literal](./08-addr-output-literal/) | literal output 抛 ExecuteOpError | negative | error | — |
| 9 | [09-addr-output-public](./09-addr-output-public/) | public output 抛错 | negative | error | — |
| 10 | [10-op-unregistered](./10-op-unregistered/) | 未注册的 op 抛 ExecuteOpError | negative | error | — |
| 11 | [11-op-registered-sanity](./11-op-registered-sanity/) | throwing_op 在 registry 中能找到 | neutral | register | — |
| 12 | [12-error-as-data-write](./12-error-as-data-write/) | op 返回 error → 写入 $r_err 寄存器 | positive | register | — |
| 13 | [13-error-last-wins](./13-error-last-wins/) | 多次执行：$r_err 被后一次 op 覆盖（last-wins） | negative | error | — |
| 14 | [14-throw-no-write-outputs](./14-throw-no-write-outputs/) | op throw 时向上抛（不写入 outputs） | negative | error | — |
| 15 | [15-throw-custom-error](./15-throw-custom-error/) | 自定义 throw 的 Error 向上抛 | negative | error | — |
| 16 | [16-status-success](./16-status-success/) | 成功：pending → running → done | positive | register | — |
| 17 | [17-status-running-stuck](./17-status-running-stuck/) | 硬错误：pending → running（保持，因为 throw 后未到 done） | negative | error | — |
| 18 | [18-flow-with-move](./18-flow-with-move/) | 完整流程：literal 5 → move → $r0 → mock_op → $r1 | positive | register | — |
| 19 | [19-flow-pipeline](./19-flow-pipeline/) | 后续可读 op 的 output 做下一轮 op 的 input | positive | register | — |
| 20 | [20-consecutive-three](./20-consecutive-three/) | 连续 3 次调用同一 op | positive | register | — |
| 21 | [21-tracker-records-inputs](./21-tracker-records-inputs/) | tracker 记录每个调用的 inputs | positive | register | — |
| 22 | [22-state-preserve-publicstore](./22-state-preserve-publicstore/) | 不动 publicStore | neutral | register | — |
| 23 | [23-state-preserve-allocator](./23-state-preserve-allocator/) | 不动 allocator | neutral | register | — |
| 24 | [24-state-preserve-other-internal](./24-state-preserve-other-internal/) | 不动其他内部寄存器 | neutral | register | — |
| 25 | [25-error-identity](./25-error-identity/) | 是 Error 子类 | neutral | register | — |

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

- 表格版单元测试清单：[`../execute-op-unit-tests.md`](../execute-op-unit-tests.md)
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[`../../../../tests/phase-a/tier-a07-execute-op.test.ts`](../../../../tests/phase-a/tier-a07-execute-op.test.ts)

## 渲染方式

```bash
plantuml -recursive execute-op-unit-test-diagram/
```
