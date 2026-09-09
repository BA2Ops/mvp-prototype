# Test #25: 完整流程：file_read 成功 → 走 then 块

> **Source**: `` → describe('')

## 目的

真实 DAG：$r_err 为 null → cond_skip falsy → 仅弹 self → 后续执行 elseBlock。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_err=null
stack: [thenBlock, skipN(1), elseBlock, cond_skip($r_err, n=2)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(3)
保留 thenBlock, skipN, elseBlock
```

## 设计决策说明

成功主路径——典型的 'if (file_read OK) run then'。

