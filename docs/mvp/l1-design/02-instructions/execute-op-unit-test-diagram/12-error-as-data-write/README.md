# Test #12: op 返回 error → 写入 $r_err 寄存器

> **Source**: `` → describe('')

## 目的

错误即数据：handler 返回 {error: OperationError} → 写入 $r_err，result 落 null，不中断。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableOp({name:'failing_op', outputs:{result:$r1, error:$r_err}}, behavior:{kind:'returnError', code:'ENOENT'})
$r0=5
```

## 预期结果与验证

```ts
resolves.not.toThrow()
$r_err.code === 'ENOENT'
$r_err.op === 'failing_op'
$r1 === null
entry.status === 'done'
```

## 设计决策说明

错误即数据：handler 返回 {error: OperationError} → 写入 $r_err，result 落 null，不中断。error-as-data 主路径——错误作为数据流通而非异常中断。

