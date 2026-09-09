# Test #13: 多次执行：$r_err 被后一次 op 覆盖（last-wins）

> **Source**: `` → describe('')

## 目的

$r_err 作为单例全局功能寄存器，验证 last-wins 语义。

## 主图

![main](./main.puml)

## 数据准备

```ts
连续两次执行 err_op_1 (E_FIRST) 与 err_op_2 (E_SECOND)
```

## 预期结果与验证

```ts
第一次后 $r_err.code === 'E_FIRST'
第二次覆盖后 $r_err.code === 'E_SECOND'
```

## 设计决策说明

global functional register 单例——后写覆盖前写。

