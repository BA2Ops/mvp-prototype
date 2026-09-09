# Test #24: 完整流程：file_read 错误 → 走 else 块

> **Source**: `` → describe('')

## 目的

真实 DAG：$r_err 为 OperationError → cond_skip truthy → 弹 self+else+skipN → 后续执行 then_block。

## 主图

![main](./main.puml)

## 子图：DAG 错误主路径时序

![DAG 错误主路径时序](./subfigures/dag-error-flow.puml)

## 数据准备

```ts
$r_err={ENOENT}
stack: [thenBlock, skipN(1), elseBlock, cond_skip($r_err, n=2)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('thenBlock')
```

## 设计决策说明

错误主路径——典型的 'if (file_read failed) run else'。

