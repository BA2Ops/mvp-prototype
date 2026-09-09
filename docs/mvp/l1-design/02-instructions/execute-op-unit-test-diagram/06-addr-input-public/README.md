# Test #6: public input 抛错

> **Source**: `` → describe('')

## 目的

非法 kind 第二种：验证按'是否 internal'二元分类。

## 主图

![main](./main.puml)

## 数据准备

```ts
inputs:{x:{kind:'public', name:'business_var'} as any}
```

## 预期结果与验证

```ts
rejects.toThrow(ExecuteOpError)
```

## 设计决策说明

拦的是'只枚举几个常见敌人'的不彻底防御。

