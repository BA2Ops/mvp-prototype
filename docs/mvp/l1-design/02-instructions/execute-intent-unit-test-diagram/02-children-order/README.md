# Test #2: children 压栈顺序：children[0] 在栈顶（先执行）

> **Source**: `` → describe('')

## 目的

三个 children 时仍维持 children[0] 最先出栈的逆序语义。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([first, middle, last]) 三个 skip_n
```

## 预期结果与验证

```ts
stack.map(e=>e.id) === [entry.id, 'last', 'middle', 'first']
逐 pop 出 first/middle/last/entry
```

## 设计决策说明

children[0] 必须先执行——逆序约定。

