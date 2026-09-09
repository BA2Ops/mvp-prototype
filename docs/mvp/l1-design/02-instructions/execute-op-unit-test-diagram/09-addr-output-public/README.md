# Test #9: public output 抛错

> **Source**: `` → describe('')

## 目的

非法 output kind 第二种。

## 主图

![main](./main.puml)

## 数据准备

```ts
outputs:{result:{kind:'public', name:'business_var'} as any}
```

## 预期结果与验证

```ts
rejects.toThrow(ExecuteOpError)
```

## 设计决策说明

拦的是'output 端忘记对称校验'的实现疏漏。

