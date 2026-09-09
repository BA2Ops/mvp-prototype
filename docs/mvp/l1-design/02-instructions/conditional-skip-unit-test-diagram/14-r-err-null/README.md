# Test #14: $r_err = null（成功）→ falsy

> **Source**: `` → describe('')

## 目的

op 执行顺利时该位置会被写回 null 而非删除——把这种约定好的'代表一切正常'的具体内容原封不动喂给条件判定。

## 主图

![main](./main.puml)

## 数据准备

```ts
internalStore.set('$r_err', null)
stack: [thenBlock, cond(n=0)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(1)
expect(stack[0].id).toBe('thenBlock')
```

## 设计决策说明

与 #10/#12 同模式断言——这次携带的是可追溯到具体生产语义的输入。

