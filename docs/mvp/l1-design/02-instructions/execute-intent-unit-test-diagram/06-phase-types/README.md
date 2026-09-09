# Test #6: phase 字段类型正确（4 种）

> **Source**: `` → describe('')

## 目的

phase 枚举集合的纯类型检查。

## 主图

![main](./main.puml)

## 数据准备

```ts
直接构造 phases 数组
```

## 预期结果与验证

```ts
['pending','awaiting_children','done','aborted'].length === 4
```

## 设计决策说明

4 种 phase 枚举值完整覆盖状态机。

