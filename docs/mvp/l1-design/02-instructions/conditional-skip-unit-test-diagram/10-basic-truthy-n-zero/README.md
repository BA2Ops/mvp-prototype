# Test #10: truthy + n=0：弹出 self

> **Source**: `` → describe('')

## 目的

命中跳转但跨度为零——只做 conditional_skip 自身这条指令本应完成的收尾动作。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = true
stack: [m1, cond(n=0)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('m1')
```

## 设计决策说明

与 skip_n 的 n=0 行为对齐——只是额外做了条件判定。

