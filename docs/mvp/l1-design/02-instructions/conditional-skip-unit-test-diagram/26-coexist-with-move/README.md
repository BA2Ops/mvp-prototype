# Test #26: 先 move 写入 $r_cond，再 conditional_skip

> **Source**: `` → describe('')

## 目的

端到端展示 move → register → conditional_skip 读取的最小链路。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [cond, move_entry]
模拟 move 已写 $r_cond=true
```

## 预期结果与验证

```ts
cond_skip truthy 弹 self 后 stack.length===0
```

## 设计决策说明

跨 primitive 最小集成测试——move 提供数据、conditional_skip 判定使用。

