# Test #14: 嵌套 L3.compile 调用链（帧嵌套）

> **Source**: `` → describe('')

## 目的

children 中包含另一个 execute_intent 子帧时，仍能维持多层帧栈结构。

## 主图

![main](./main.puml)

## 数据准备

```ts
createMockL3([self_skip, self_entry{kind:'execute_intent'}])
entry={type:'recursive_exp'}
```

## 预期结果与验证

```ts
stack=[entry, self_entry, self_skip]
pop 顺序 self_skip → self_entry → entry
```

## 设计决策说明

帧嵌套——L3.compile 递归调用链。

