# Test #2: 调用 throwing_op 应抛错（硬错误）

> **Source**: `` → describe('')

## 目的

硬错误路径：handler 直接 throw → 异常上抛 → entry.status 停在 running。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry=throwing_op(inputs:{}, outputs:{})
```

## 预期结果与验证

```ts
rejects.toThrow('hard error')
entry.status === 'running'
stack.length === 1（不弹栈）
```

## 设计决策说明

status='running' 表明'正在执行但未完成'——设计选择。

