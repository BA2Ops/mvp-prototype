# Test #9: n=0 在空栈上调用

> **Source**: `` → describe('')

## 目的

零弹请求 + 空栈组合。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [] (不 push)
entry: skip_n(n=0)
```

## 预期结果与验证

```ts
expect(executeSkipN(skip, state)).resolves.not.toThrow()
expect(stack.length).toBe(0)
```

## 设计决策说明

最小边界组合——零弹在空栈上不应报错。

