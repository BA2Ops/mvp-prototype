# Test #2: n 足够大也不跨帧（栈中保留帧）

> **Source**: `` → describe('')

## 目的

即使请求弹出远超实际条目的数量也不允许跨过帧。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [frame(IE), m1, self]
entry: skip_n(n=100)
```

## 预期结果与验证

```ts
expect(stack.map(e=>e.id)).toEqual(['frame'])
```

## 设计决策说明

m1 被吃掉但 frame 仍保留——边界绝对性。

