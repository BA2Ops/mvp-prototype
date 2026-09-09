# Test #11: truthy + n=2：弹出 self + 2 个后续

> **Source**: `` → describe('')

## 目的

跨条目跳跃首次登场：确认被跳过的两条确实从可见栈顶彻底消失。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = true
stack: [keep, m1, m2, cond(n=2)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('keep')
```

## 设计决策说明

按 id 点名核对，避免'总数字对但错的条目被删'置换型 bug。

