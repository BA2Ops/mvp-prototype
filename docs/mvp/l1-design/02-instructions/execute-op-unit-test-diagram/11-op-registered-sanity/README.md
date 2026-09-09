# Test #11: throwing_op 在 registry 中能找到

> **Source**: `` → describe('')

## 目的

配套 sanity check：确认 mockL2 已注册该 op。

## 主图

![main](./main.puml)

## 数据准备

```ts
直接 state.l2.has('throwing_op') 等
```

## 预期结果与验证

```ts
state.l2.has('throwing_op') === true
state.l2.has('mock_op') === true
```

## 设计决策说明

确保 #2 抛错是来自执行而非注册缺失。

