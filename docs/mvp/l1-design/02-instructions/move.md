# `move` — 数据搬运

## 指令结构定义

```typescript
interface MoveEntry extends BaseEntry {
  kind: 'move'
  from: Address   // 源地址（4 种 kind 均可）
  to: Address     // 目标地址（不能是 literal）
}
```

这是 L1 **唯一的数据操作 primitive**——其余 4 个 primitive 要么执行计算（execute_op）、要么控制流程（skip_n/conditional_skip）、要么触发更高层编译压栈（execute_intent），只有 move 直接改变存储区的值。

## 用途

把 `from` 指向的值搬到 `to`。

**核心用途是充当双数据区的唯一桥梁**——进出两个方向都要走 move：

| 方向 | from → to | 典型场景 |
|---|---|---|
| **inbound**（外部→内部） | literal / public → internal | 给 op 准备参数：literal 常量装载；已有业务数据加载进寄存器 |
| **outbound**（内部→外部） | internal → public | 经验产物/计算结果持久化到 publicStore |

> （原先 inbound/outbound 里还各有一类 `file` 参与的方向——直接读写磁盘的 move，现已随 file kind 一起移除；等价的真实读盘/写盘动作改由 `execute_op('file_read')` / `execute_op('write_file')` 在各自 execute() 内完成。）
| **区内搬运** | internal → internal / public → public | 同帧内 slot 间复制重命名、业务变量重定向 |

之所以两个方向都离不开 move，是因为 execute_op 的 outputs 被硬性约束只能写 internal kind Address——op 自己算出的值不会自动出现在 publicStore 里（真实磁盘 IO 则完全封装在 op 内部、根本不经过 L1 Address 体系）；同理条件判断/skip 也**只**能读 internal。所以"把某个区的值搬到另一个区"这件事必须显式物化成一条独立的 move entry，而不是隐含在某条计算指令的参数解析逻辑里。

## 预期执行效果

按顺序：(1) resolveAddress(from, state) → value；(2) writeAddress(to, value, state)；(3) pop self。**仅在两步都成功时才弹栈**——任一环节抛 AddressError，entry 原地保留在栈上供上层错误处理逻辑查看/决策，不会因为搬了一半数据就静默消失丢现场。（另有一条针对 CRR post-bindings 特殊路径的软跳过分支：from.kind='internal' && to.kind='public' && 源 key 不存在时 warn + skip 而非硬失败，详见下方"边界行为"。）

## from / to 各 kind 组合的行为矩阵

| from \ to | literal | public | internal |
|---|---|---|---|
| **literal** | ✗（write 阶段报 LITERAL_WRITE） | ✅ | ✅ |
| **public** | ✗（同上） | ✅ | ✅ |
| **internal** | ✗（同上） | ✅* | ✅ |

\* `internal→public` 这一格有一个特殊弱化语义：若 source register 尚未被写入过（例如对应 op 还没执行到、或走的是 error/abort 路径），不抛错而是打一条 warning 并当作完成处理掉这条 move——这是为 CRR P2 "post-bindings materialization" 场景专门加的宽容通道，其余所有格子仍是严格语义，任何 resolve/write 阶段的异常都会向上抛。

> to=literal 之所以在全部组合里都必然报错，是因为字面量在设计上就是"只读的常量节点"，写进去没有存储位置可落；这个约束对所有来源一视同仁，不分从哪来。
>
> ✅ **原第 4 种 kind=`file` 已彻底移除**（连同 resolver 的两个 case 分支 + `isFileAddress` guard 一并清理）。原先的设计是把文件系统本身当作可直接寻址的存储区域，`move(file→X)`/`move(X→file)` 会直接在 `resolveAddress`/`writeAddress` 内调用 `fs.readFile`/`fs.writeFile`；但后来明确"IO 职责应全部下沉到 L2 op 承担"（读用 `execute_op('file_read')`、写用 `execute_op('write_file')`，各自在自己的 execute() 里做真实 fs 调用），因此从类型层直接删掉了这个分支，让矩阵收敛为上图的 3×3。

## 合法格式示例

以下都是**编译期即可静态判定合法**的完整 MoveEntry 形状（省略 id/parentIntentId/createdAt 三个公共字段，下同）。`from`/`to` 各自只可能是 `literal` / `public` / `internal` 三种之一：

```typescript
// （生产常见）literal → internal：装载一个常量进寄存器（execute_op 用它之前必经的一步）
{ kind: 'move', from: { kind: 'literal', value: '/tmp/data.txt' }, to: { kind: 'internal', name: '$r_input_path' } }

// （生产常见）internal → public：op 跑完后的结果持久化到 business store（post-bindings materialization）
{ kind: 'move', from: { kind: 'internal', name: '$Ss0.out5' }, to: { kind: 'public', name: 'exp_x.content' } }

// （生产常见）internal → internal：同一个 frame 内把一个 slot 的值复制到另一个 slot（"寄存器重命名"/别名，例如把 out-slot 复制给后续 argtmp pool 复用）
{ kind: 'move', from: { kind: 'internal', name: '$Ss0.out2' }, to: { kind: 'internal', name: '$Ss0.argtmp3' } }

// public → internal：把已有业务数据加载进寄存器供 op 使用
{ kind: 'move', from: { kind: 'public', name: 'business_var' }, to: { kind: 'internal', name: '$r_input_path' } }
```

> 原先还存在 `file→X` / `X→file` 这类直接读写磁盘的 move 形状，现已随 file kind 一起删除——等价的真实 IO 改由 execute_op('file_read') / execute_op('write_file') 承担。其余未列出的组合（如 literal→public、public→literal）结构上同理可构造且语义一致，不再逐条重复罗列示例。

**唯一不合法的形状**就是 `to.kind === 'literal'`（任意来源），编译期就应当被拦下而不是留到运行时才发现。

## 边界行为速查

- resolve/write 任一环节失败 → AddressError 向上抛 + **self 留在栈上不弹**。
- internal→public 且 source key 缺失 → console.warn + 当成功处理掉 self（软跳过，见上文*号说明）。
- move 本身没有任何"条件""分支""调用外部函数"的语义——它永远只做上面三步里的两步存储操作加一次弹栈，不存在第四种可能的执行路径分叉。
