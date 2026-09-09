# Test #10: 默认语义：false = 异常向上冒泡

> **Source**: `` → describe('')

## 目的

L3 编译产物必须显式为每条 children 设置 handleError；缺省等同 false → 异常向上冒泡。

## 主图

![main](./main.puml)

## 数据准备

```ts
构造 children[0]={...,handleError:false}
```

## 预期结果与验证

```ts
children[0] 已定义且 handleError === false 显式存在（无 undefined 兜底）
```

## 设计决策说明

显式语义——禁止隐式 default。

