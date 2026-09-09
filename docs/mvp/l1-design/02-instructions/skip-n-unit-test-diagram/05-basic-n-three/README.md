# Test #5: n=3：弹出 self + 3 个后续（4 个）

> **Source**: `` → describe('')

## 目的

跨条目弹出三条：被跳过的从可见栈顶彻底消失而非仅打标记。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [keep, m3, m2, m1, skip(n=3)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('keep')
```

## 设计决策说明

逐一按 id 点名核对，避免'总数字对但错的条目被删'的置换型 bug。

