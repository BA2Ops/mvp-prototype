<!-- density: standard | max-cell=150 | bpr=350-550 | total-kb=15 -->

# conditional-skip 单元测试图谱（PlantUML 版）

本目录为 conditional-skip 的 31 个单元测试用例提供**图形化注释**：每个 test 一个独立子目录，含 PlantUML 主图 + 详细 README + 必要时子图。

## 目录约定

```
<test-#>-<test-name>/
├── main.puml         # PlantUML 主图：表达被测场景 + note 解释
├── README.md         # 详细说明：目的 / 数据准备 / 验证 / 设计决策
└── subfigures/       # 子图目录（按需）：sequence diagram 等补充视图
```

## 31 个测试一览

| # | 目录 | test() 名称 | 类型 | 视图 | 子图 |
|---|------|------------|------|------|------|
| 1 | [01-frame-boundary-truthy](./01-frame-boundary-truthy/) | 条件为真且 n 足够大 → 停在帧前 | positive | stack | — |
| 2 | [02-istruthy-null-undefined](./02-istruthy-null-undefined/) | null/undefined → false | positive | stack | — |
| 3 | [03-istruthy-boolean](./03-istruthy-boolean/) | boolean → 本人 | positive | stack | — |
| 4 | [04-istruthy-number](./04-istruthy-number/) | number: 0 → false, 非零 → true | positive | stack | — |
| 5 | [05-istruthy-string](./05-istruthy-string/) | string: 空串 → false, 非空 → true | positive | stack | — |
| 6 | [06-istruthy-array](./06-istruthy-array/) | array: 空数组 → false, 非空 → true | positive | stack | — |
| 7 | [07-istruthy-object](./07-istruthy-object/) | object: 空对象 → false, 非空 → true | positive | stack | — |
| 8 | [08-istruthy-operationerror](./08-istruthy-operationerror/) | error-as-data 场景：OperationError 对象 → truthy | positive | stack | — |
| 9 | [09-empty-object-false-branch](./09-empty-object-false-branch/) | conditional_skip 用空对象作为条件值（false 分支） | positive | stack | — |
| 10 | [10-basic-truthy-n-zero](./10-basic-truthy-n-zero/) | truthy + n=0：弹出 self | positive | stack | — |
| 11 | [11-basic-truthy-n-two](./11-basic-truthy-n-two/) | truthy + n=2：弹出 self + 2 个后续 | positive | stack | — |
| 12 | [12-basic-falsy-n-zero](./12-basic-falsy-n-zero/) | falsy + n=0：仅弹出 self | positive | stack | — |
| 13 | [13-basic-falsy-n-two](./13-basic-falsy-n-two/) | falsy + n=2：仅弹 self，不跳 m1/m2 | positive | stack | — |
| 14 | [14-r-err-null](./14-r-err-null/) | $r_err = null（成功）→ falsy | positive | stack | — |
| 15 | [15-r-err-operationerror](./15-r-err-operationerror/) | $r_err = OperationError（失败）→ truthy | positive | stack | — |
| 16 | [16-addr-literal](./16-addr-literal/) | literal kind 抛 ConditionalSkipError | negative | error | — |
| 17 | [17-addr-public](./17-addr-public/) | public kind 抛 ConditionalSkipError | negative | error | — |
| 18 | [18-addr-file](./18-addr-file/) | file kind 抛 ConditionalSkipError | negative | error | — |
| 19 | [19-addr-internal-ok](./19-addr-internal-ok/) | internal kind 通过校验 | positive | stack | — |
| 20 | [20-param-n-negative-min](./20-param-n-negative-min/) | n=-1 抛 ConditionalSkipError | negative | error | — |
| 21 | [21-param-n-negative-deep](./21-param-n-negative-deep/) | n=-100 抛 ConditionalSkipError | negative | error | — |
| 22 | [22-graceful-missing-reg](./22-graceful-missing-reg/) | 内部寄存器不存在视为 falsy（不抛错） | positive | stack | — |
| 23 | [23-graceful-stack-underflow](./23-graceful-stack-underflow/) | 栈不足时不抛错（truthy 但栈已空） | positive | stack | — |
| 24 | [24-dag-error-then-else](./24-dag-error-then-else/) | 完整流程：file_read 错误 → 走 else 块 | positive | stack | [dag-error-flow.puml](./24-dag-error-then-else/subfigures/dag-error-flow.puml) |
| 25 | [25-dag-success-then](./25-dag-success-then/) | 完整流程：file_read 成功 → 走 then 块 | positive | stack | — |
| 26 | [26-coexist-with-move](./26-coexist-with-move/) | 先 move 写入 $r_cond，再 conditional_skip | positive | stack | — |
| 27 | [27-consecutive-two](./27-consecutive-two/) | 连续两个 conditional_skip | positive | stack | — |
| 28 | [28-state-preserve-publicstore](./28-state-preserve-publicstore/) | 不动 publicStore | neutral | stack | — |
| 29 | [29-state-preserve-other-reg](./29-state-preserve-other-reg/) | 不动其他 internal 寄存器 | neutral | stack | — |
| 30 | [30-state-preserve-allocator](./30-state-preserve-allocator/) | 不动 allocator | neutral | stack | — |
| 31 | [31-error-identity](./31-error-identity/) | 是 Error 子类 | neutral | stack | — |

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

- 表格版单元测试清单：[`../conditional-skip-unit-tests.md`](../conditional-skip-unit-tests.md)
- 当前目录（图谱版）：详细解释 + 图形化注释（本目录）
- 源文件：[`../../../../tests/phase-a/tier-a06-conditional-skip.test.ts`](../../../../tests/phase-a/tier-a06-conditional-skip.test.ts)

## 渲染方式

```bash
plantuml -recursive conditional-skip-unit-test-diagram/
```
