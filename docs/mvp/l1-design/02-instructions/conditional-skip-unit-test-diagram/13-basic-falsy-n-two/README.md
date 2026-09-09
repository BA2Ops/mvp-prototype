# Test #13: falsy + n=2：仅弹 self，不跳 m1/m2

> **Source**: `` → describe('')

## 目的

本组最有区分力的一条：同 n=2 在 truthy 侧会触发两条跳过，在 falsy 侧必须完全不碰。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = null
stack: [keep, m1, m2, cond(n=2)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(3)
保留 m1/m2 相对次序
```

## 设计决策说明

防止实现把判定条件布尔极性反转或弹栈数量公式写串。

