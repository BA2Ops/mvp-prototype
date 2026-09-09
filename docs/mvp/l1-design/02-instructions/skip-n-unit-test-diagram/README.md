<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# skip-n 单元测试图谱（PlantUML 版）

本目录为 skip-n 的 22 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

```
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
```

## 22 个测试一览

| # | 目录 | test() 名称 | 类型 | 视图 | 子图 |
|---|------|------------|------|------|------|
| 1 | [01-frame-boundary-stop](./01-frame-boundary-stop/) | 弹出时遇到帧 → 停止（不跨帧） | positive | stack | — |
| 2 | [02-frame-boundary-large-n](./02-frame-boundary-large-n/) | n 足够大也不跨帧（栈中保留帧） | positive | stack | — |
| 3 | [03-basic-n-zero](./03-basic-n-zero/) | n=0：仅弹出 self（1 个） | positive | stack | — |
| 4 | [04-basic-n-one](./04-basic-n-one/) | n=1：弹出 self + 1 个后续（2 个） | positive | stack | — |
| 5 | [05-basic-n-three](./05-basic-n-three/) | n=3：弹出 self + 3 个后续（4 个） | positive | stack | — |
| 6 | [06-basic-n-large](./06-basic-n-large/) | n=10：弹空所有栈（仅 1 个元素时） | positive | stack | — |
| 7 | [07-graceful-underflow](./07-graceful-underflow/) | 栈不足时不抛错（graceful） | positive | stack | — |
| 8 | [08-graceful-empty](./08-graceful-empty/) | 空栈调用安全（虽然不符合实际执行流程） | positive | stack | — |
| 9 | [09-graceful-empty-n-zero](./09-graceful-empty-n-zero/) | n=0 在空栈上调用 | positive | stack | — |
| 10 | [10-param-n-negative-min](./10-param-n-negative-min/) | n=-1 抛 SkipNError | negative | error | — |
| 11 | [11-param-n-negative-deep](./11-param-n-negative-deep/) | n=-100 抛 SkipNError | negative | error | — |
| 12 | [12-error-identity](./12-error-identity/) | SkipNError 是 Error 子类 | neutral | stack | — |
| 13 | [13-dag-cond-false](./13-dag-cond-false/) | 场景 1：跳过 then-block（条件为假） | positive | stack | — |
| 14 | [14-dag-cond-true](./14-dag-cond-true/) | 场景 2：跳过 then-block（条件为真也走此路径） | positive | stack | — |
| 15 | [15-dag-full-manual](./15-dag-full-manual/) | 场景 3：完整 DAG 模拟（手动驱动） | positive | stack | [dag-sequence.puml](./15-dag-full-manual/subfigures/dag-sequence.puml) |
| 16 | [16-state-preserve-publicstore](./16-state-preserve-publicstore/) | 不动 publicStore | neutral | stack | — |
| 17 | [17-state-preserve-internalstore](./17-state-preserve-internalstore/) | 不动 internalStore | neutral | stack | — |
| 18 | [18-state-preserve-allocator](./18-state-preserve-allocator/) | 不动 allocator | neutral | stack | — |
| 19 | [19-state-preserve-references](./19-state-preserve-references/) | 不动 l2/l3 引用 | neutral | stack | — |
| 20 | [20-coexist-with-move](./20-coexist-with-move/) | move 完成后再 skip_n | positive | stack | — |
| 21 | [21-consecutive-two](./21-consecutive-two/) | 连续两个 skip_n | positive | stack | — |
| 22 | [22-consecutive-with-other](./22-consecutive-with-other/) | skip_n 之间有其他 entry | positive | stack | — |

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

- 表格版单元测试清单：[`../skip-n-unit-tests.md`](../skip-n-unit-tests.md)
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[`../../../../tests/phase-a/tier-a05-skip-n.test.ts`](../../../../tests/phase-a/tier-a05-skip-n.test.ts)

## 渲染方式

```bash
plantuml -recursive skip-n-unit-test-diagram/
```
