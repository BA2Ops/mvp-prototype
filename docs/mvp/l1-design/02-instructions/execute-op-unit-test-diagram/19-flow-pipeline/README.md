# Test #19: 后续可读 op 的 output 做下一轮 op 的 input

> **Source**: `` → describe('')

## 目的

多轮流水线：round 1 output 作为 round 2 input。

## 主图

![main](./main.puml)

## 数据准备

```ts
op1: 5 → $r1=10
op2: 10 → $r3=20
```

## 预期结果与验证

```ts
完成后 $r3 === 20（即 10*2）
```

## 设计决策说明

流水线场景——验证 outputs 可以立即作为下一轮 inputs。

