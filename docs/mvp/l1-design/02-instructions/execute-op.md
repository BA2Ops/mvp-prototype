# `execute_op` — 调用一个已注册的 L2 Operation

## 指令结构定义

```typescript
interface OpEntry extends BaseEntry {
  kind: 'execute_op'
  operation: string                    // op 名（如 'file_read', 'string_replace'）
  inputs: Record<string, Address>     // 每个 key 必须对应 internal kind
  outputs: Record<string, Address>    // 同上，全部必须是 internal kind
  status: 'pending' | 'running' | 'done'   // L1 自己在执行过程中会推进这个字段
}
```

inputs/outputs 的 **key 是业务参数名**（对应目标 op 自己 formalSpec 声明的参数），value 是它落到哪个 internalStore slot——两层信息缺一不可：L1 靠 value 找数据在哪、op.execute() 拿到的实参 dict 又靠 key 才能对上号。

## 用途

这是 L1 与 L2 之间唯一的"函数调用"通道：L1 不感知具体 op 做什么业务事，只负责按名字查表找到 op 对象、把 inputs 里的地址逐个解析成真实值打包成一个普通 JS 对象传进 `op.execute()`、再把返回值逐条写回 outputs 声明的内部寄存器槽位。任何一段需要"算出一个新东西出来"的逻辑都必须走这条指令，哪怕只是 evaluate_expr 这种看起来像内置的求值器也一样——L1 自己没有算术运算能力。

## 预期执行效果

按顺序：(1) registry.get(operation)，找不到 → ExecuteOpError；(2) validateOutputs(outputs)——纯结构校验，只看每个 Address.kind 是不是都等于 'internal'，此时不读任何实际值；(3) status='running'；(4) resolveInputs(inputs, state)——逐个从 internalStore 读出真实 Value，装进一个普通的 `{ [key]: value }` 字典作为 execute 的入参（**这一步不会反向改变 internalStore 本身的内容**）；(5) `await op.execute(resolvedInputs, state)`；(6) 成功返回后逐条把 outputs 对应的 name→Address 写入对应 internalStore key；(7) status='done' + pop self。

第 (5) 步是整条指令唯一可能抛出非 L1-系统错误的位置，且分两条互斥的处理路径：
- **op 自己没 throw，而是把结构化 OperationError 放进返回值里某个字段（约定俗成通常是 error）** → 当作普通一次成功调用处理完，写回所有 outputs（包括那个装着错误的字段），后续由 DAG 里的 conditional_skip 检查这个 slot 决定怎么处置；L1 层完全不知道这次算"失败"还是"成功"。
- **op 直接 throw（任意异常，业务上没预料到的崩溃/参数不合法等等）** → 原样向上抛给 main loop 的统一 catch 分支走 bubbleError 冒泡机制（见 ../04-error-handling.md 规划文档）。

这两条路径不是 L1 "选一条执行"的意思——它们取决于被调用的 op 内部怎么写代码、遇到什么情况选择哪种表达方式汇报结果，L1 只是被动接收并分别按上面两种收尾逻辑机械执行而已。

## 可穷举的格式维度与示例

execute_op 本身没有枚举得尽的固定取值集合（inputs/outputs 的具体 key/value 数量随所调用的 op 而变），但它的**结构形状是封闭的**：operation 必须是字符串名 + inputs/outputs 各自是一组 `{业务名: internal Address}` 键值对。下面用一个真实存在的 builtin（`file_read`，其 formalSpec 声明 input `path`、output `content`+`error`）给出一个完整合法的 OpEntry：

```typescript
{
  kind: 'execute_op',
  operation: 'file_read',
  inputs: { path: { kind: 'internal', name: '$r_input_path' } },   // ← key='path' 对应 fileReadOp.formalSpec.inputs.path
  outputs: {
    content: { kind: 'internal', name: '$Ss0.out2' },             // ← CRR new path 下按 slotIndex 定位到具体 out-slot
    error: { kind: 'internal', name: '$err' }                     // ← 约定俗成的全局错误槽位
  },
  status: 'pending'
}
```

对比一条 legacy path（feature flag 关闭时 compiler 生成的老风格命名，同一 op 同一个调用逻辑不变）：

```typescript
inputs:  { path: { kind: 'internal', name: '$r0' } },
outputs: { content: { kind: 'internal', name: '$r1' }, error: { kind: 'internal', name: '$r_err' } }
```

两条形状完全同构，只有 Address.name 字符串本身遵循不同的命名规则——**L1 execute-op 的执行逻辑对这两种写法没有任何区别对待**，它只关心 "这个字符串在 internalStore 里能不能查到值 / 能不能写进去"。

## 边界行为速查

- operation 名不在 registry → ExecuteOpError，self 留在栈上不弹。
- inputs/outputs 任一 Address.kind !== 'internal' → ExecuteOpError（第 (2)(4) 步各自的校验点分别拦截）。
- op.execute 自身 throw → 原样向上抛，交给 main loop catch + bubbleError，本 entry **不会被标记 done**。
- op.execute 正常返回但 outputs 里某个 key 缺失（op 自己没按契约给全字段）→ `writeAddress(addr, undefined)`，即该 slot 会被写入 `undefined` 而不是保持原值或报错——这是一个值得注意的静默降级行为，依赖 op 自己的正式契约保证不会发生，L1 不做额外的字段完整性交叉核对。
