# Test #27: 连续两个 conditional_skip

> **Source**: `` → describe('')

## 目的

两个相邻 cond 各自读取不同寄存器后互不干扰。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_a=true, $r_b=false
stack: [cond1($r_a,n=0), cond2($r_b,n=0)]
```

## 预期结果与验证

```ts
先 pop cond2 falsy → stack.length===1
再 pop cond1 truthy → stack.length===0
```

## 设计决策说明

交叉场景——验证多 cond 的弹栈顺序由各自条件决定而非栈结构。

