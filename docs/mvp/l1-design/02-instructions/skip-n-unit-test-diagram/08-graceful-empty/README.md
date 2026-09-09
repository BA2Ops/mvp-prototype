# Test #8: 空栈调用安全（虽然不符合实际执行流程）

> **Source**: `` → describe('')

## 目的

即便栈本就为空，被调用时也安全——防止被调用时不至于崩。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [] (不 push 任何 entry)
entry: skip_n(n=3)
```

## 预期结果与验证

```ts
expect(executeSkipN(skip, state)).resolves.not.toThrow()
expect(stack.length).toBe(0)
```

## 设计决策说明

main loop 不会从空栈取 skip_n 执行——此用例是防御性的'如果被调用'路径。

