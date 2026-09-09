# Test #20: 连续 3 次调用同一 op

> **Source**: `` → describe('')

## 目的

多次连续调用计数与各自 output 正确写入。

## 主图

![main](./main.puml)

## 数据准备

```ts
i ∈ [1,3]: set $r0=i, entry=mock_op(outputs.result=`$r${i+1}`)
```

## 预期结果与验证

```ts
tracker.getCallCount() === 3
$r2 === 2, $r3 === 4, $r4 === 6
```

## 设计决策说明

同一 op 多次调用——tracker 累计 + outputs 各次独立写入。

