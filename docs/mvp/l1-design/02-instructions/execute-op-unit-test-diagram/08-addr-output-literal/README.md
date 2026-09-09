# Test #8: literal output 抛 ExecuteOpError

> **Source**: `` → describe('')

## 目的

非法 output kind 第一种。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r0=5
outputs:{result:{kind:'literal', value:0} as any}
inputs 合法
```

## 预期结果与验证

```ts
rejects.toThrow(ExecuteOpError)
rejects.toThrow(/output 'result' must be internal/)
```

## 设计决策说明

output 端独立白名单——与 input 端镜像。

