# 19b - Register File Redesign：详细设计

> **状态**：Draft v0.1（2026-08-21，待评审）。本文档是[需求文档](./19-register-file-core.md)的*实现方案*——把 C1–C5 拆成 R5.x/R6.x 子项、给出数据结构变更、编译器伪代码、Walkthrough、分阶段计划与风险清单。
> **前置阅读**：[doc 06 执行层](./06-execution-layer.md)（L1 primitive / Address 模型）、[doc 09 L1 实现](./09-l1-implementation.ts)、[doc 10 §二/§四](./10-reactive-execution-model.md)（双区架构 + L3 服务契约）、[现有源码](../../src/)。

---

## 一、现状诊断：当前寄存器系统的 5 个结构性缺陷

逐条对照代码事实（引用具体文件/行为）：

| # | 缺陷 | 证据位置 | 后果 |
|---|------|---------|------|
| D-1 | `$r_argtmp_<N>` 自增无回收 | [compiler.ts expandRefs](../../src/l3/compiler.ts):`ARG_TMP_PREFIX + ctx.tmpCounter++`，counter 只在 compileExperience 内部递增跨调用不 reset | internalStore.size() ≈ 累计 literal 数，**单调增长**；违反 C1 |
| D-2 | 业务寄存器名硬编码在经验定义里，无"slot↔op"映射约定 | experience-library.ts 所有 outputs `{kind:'register', name:'$r_content'/'$r_matches'/…}` 是作者手写字符串;formalSpec.register('$r0') 与实际使用($r_*)不一致 | A→B 同名 input 静默覆盖(A.bindInputs 的 $r_input_* 会被 B.bindInputs 再 move);C2/C3 都缺地基 |
| D-3 | RegisterAllocator(L1)定义了却没人用 | execution-state.ts `allocate()` / compiler.ts 闭包内零调用 | "固定池+allocator 复用"停在纸面,doc D-T5/Layer4 §五.5.3 的承诺未兑现 |
| D-4 | publicStore 存在但零写入点 | address-resolver.writeAddress(kind:'public')分支可达,但全代码库没有产生该路径的 entry(compiler bindInputs 只写 kind:'internal';execute_op outputs 全是 internal) | 多轮会话/跨意图产物无处落地;方向 B/F 的地基空缺(C5 要补) |
| D-5 | evaluate_expr op 有 env map 机制但 compiler 从未填过它 | [evaluate-expr.ts readVar](../../src/l2/builtins/evaluate-expr.ts)`ctx.env[name] ?? name`;compiler 生成 evaluate_expr OpEntry 时 inputs 只有 expr,outputs.result/error;**env 字段留空** | 条件表达式里 `{type:'var',name:'$r_err'}` 走 `?? name` fallback 直接命中 global $err(碰巧对),业务变量引用则依赖作者命名约定——C3/C2 统一后必须显式填充 env |

### 现状 L1 dispatch 一条 file_read 的真实数据流(供对照)

```
entry.inputs  = { path:   Address{kind:'internal', name:'$S?in0'} }     ← (R5 前是 '$r_input_path',手工拼名)
entry.outputs = { content:Address{...,'$out0'}, error:{$err} }          ← (R5 前 '$r_content'+硬编码全局$r_err)

dispatch(execute_op):
  resolveInputs(): state.internalStore.get('$in0') → A.path               ★动态读 internalStore[槽位名]
  op.execute(resolved, state) → {content:'hello', error:null}           ★op只返回value,key=formalSpec.businessName
  for [k,addr] of outputs: writeAddress(addr,k=content→$out0 / k=error→$err)
  entry.status='done'; stack.pop()
```

**要点**:L1 层其实已经很"CPU 化"(固定地址+slot语义),问题全部出在 **compiler 生成 slot 名的策略**(D-1/D-2)+ **formalSpec 与实际使用脱节(D-3)** + **缺少 scope prefixing(CALL/RET 隔离缺失,C3 缺最后一块拼图)**。

---

## 二、目标寄存器文件模型(对应 C1–C4)

### R5.1 — 三类寄存器的正式命名与数量上限

| 类别 | 形式 | MVP 上限 U_max | CPU 类比 | 生命周期 |
|------|------|--------------|---------|----------|
| **A Global Functional Registers** | `$err` (替代 $r_err) · `$path` (D-E2-1 path marker);预留 ≤6 空位给未来扩展($argc/$tmp_sys…) | **≤8枚硬编码枚举**,超出走 doc N6 变更流程 | FLAGS / STATUS REGISTER(x86 EFLAGS;ARM CPSR) | mainLoop 全程共享,last-writer-wins;$err 由 bubbleError/op error output 显式 set,不被通用池复用 |
| **B Input Argument Slots** | `$.in<k>` k=0..M_max-1(MVP M_max=4;每 op formalSpec.inputs.slotIndex∈[0,M_max)) | ≤4 物理槽位,**跨 op/experience 轮转复用** | RISC ALU 源操作数寄存器(rsrc0/rsrc1/x86 GPR src operand) | slot 归属 = "该 step dispatch in → done+pop"窗口内;op.execute 只读不写(纯函数契约),done 后值自然失效被下一 step move/execute_op 覆盖 |
| **C Output Result Slots** | `$.out<k>` k=0..P_max-1(P_max=3;含一个隐式 error alias→全局 $err,不另占 out slot) | ≤3 + 复用$err | ALU 目标寄存器(rdst;x86 dest operand register) | 同 B:dispatch in→done 期间稳定;**消费约定**:下游必须在本 op done 前完成 move/copy(否则允许覆盖);compiler 静态检查保证(见 §三 expandRefs 伪代码) |

### 命名统一规则(R5.2 — compiler 生成的 Address.name 一律形如 `$<scope>.in<k>` / `$<scope>.out<k>`)

```typescript
// types.ts（新增常量;旧名保留为 deprecated alias 一迭代期）
export const GLOBAL_ERR   = '$err'       // 旧别名 ERROR_REGISTER='$r_err'(errors.ts)过渡 P1–P4, P5删
export const GLOBAL_PATH  = '$path'      // 旧别名 '$r_path';resolveResponse 引用同步改名
export const SLOT_PREFIX_IN  = (s:string,k:number)=>`$${s}.in${k}`
export const SLOT_PREFIX_OUT = (s:string,k:number)=>`$${s}.out${k}`
export const SCOPE_ROOT     = 'S0'       // L4/Layer4 根意图 frame scope;每嵌套一层 +1 → S1,S2…
```

**为什么 `$.` 而不是裸 $in0?** —— 避免与 publicStore 业务变量名、literal sidecar pool(D-1 修复后的 argtmp)、global functional registers 三类命名空间冲突;同时让"这是一个 slot 地址而非全局/业务数据"在字符串层自解释(可读性+调试友好)。CPU 类比:这相当于把 bank-select bit 编码进 effective address(`segment:offset`,x86 实模式段寄存器模型)。

### R5.3 — Frame Scope Prefixing(CALL/RET 隔离,C3 的最后一块拼图)

```typescript
// execution-state.ts（替代现有 RegisterAllocator;保留类名以最小化 import diff,或改名为 FrameScopeAllocator）
class FrameScopeAllocator {
  private counter = 0                       // P0:S0 reserved for root intent
  next(): string            // push: returns current prefix, then ++counter  (enterIntent 调用)
  pop(): void               // done+pop / aborted 时 --counter              (exitIntent 调用点同现 recursion.ts enterIntent/exitIntent)
  static errorRegister(){ return GLOBAL_ERR }
}
```

- **复用现有 enterIntent/exitIntent 时机**(main-loop.processIntentEntry Step pending→awaiting_children 与 awaiting_children→done/bubbleError),**零新增 hook**。scope 值随 CALL 深度单调递增、返回时回退——物理上等价于 CPU CALL/RET 切换栈帧 base pointer(RBP shadow):通用寄存器号不变($in0/$out0),但属于不同 frame scope。
- **编译器闭包捕获 `currentScope`**(makeNestedIntent/compileOp/bindInputs 都接收 ctx.scopePrefix 参数,由 execute_intent dispatch in 前的 l3.compile(intent,state)透传——L1 main-loop 不需要感知字符串规则)。
- **$err/$path 不参与 scope**(跨帧可见,C4);argtmp literal pool(§五 R6a)、conditional/judgment scratch(cond_<j>/judge_<j>,见 §四)同理走 global-scope 池而非 per-frame slot。

### R5.4 — evaluate_expr / conditional_skip 引用这些 slot 的方式(env map 显式填充)

compiler 生成 evaluate_expr OpEntry 时:
```typescript
const env = collectVarRefs(j.trigger.condition_expr)   // 静态遍历 AST {type:'var',name}
            .reduce((acc,n)=>{ acc[n]=resolveSlotFor(n /*'$r_content'→业务变量名,不变*/); return acc }, {})
// resolveSlotFor: '$err'/'$r_err' → $err (全局);否则返回业务变量名本身($r_content 等)
// C6: 表达式变量引用业务变量名,不是物理寄存器名;业务变量在 internalStore 中以 $r_<name> 为 key
return { kind:'execute_op', operation:'evaluate_expr', inputs:{expr:{kind:'internal',name:`${SCOPE_ROOT}.cond_${j.id}`}}, outputs:{result:{...`judge_${j.id}`},error:{GLOBAL_ERR}}, /* ★新增env字段传递 */ ... }
// execute-op.ts Step5 调用 op.execute(resolvedInputs, state) —— evaluateExprOp.formalSpec.inputs.env.register='$in1'(R5.2 规则),value 即上面的 env map(从 literal move 到 $in1,或直接走 sidecar pool 装载字面量对象——见 R6a)
conditional_skip.conditionAddr = Address{name:`${s}.out${k_of_judgeResult}`}      // compileBranch 里把 judgeReg 改为 slot 引用
```

**收益**:D-5 修复——env 不再 fallback `?? name`;C3/C4 统一后 evaluate_expr 的变量命名空间与通用 slot 完全一致,无需特殊处理。

---

## 三、编译器变更伪代码（核心改动点）

### expandRefs：消灭 argtmp 自增，改用固定池轮转(R6a)+ scope-aware slot 名 + 业务变量区中转

```typescript
function expandRefs(refs: Record<string,ParamRef>, dir:'in'|'out', ctx): {moves, addrs} {
  const addrs={}, moves=[]
  for ([name, ref] of Object.entries(refs)) {
    if (ref.kind === 'literal') {
      if (dir==='out') throw …                    // output 不能是 literal
      const reg = ctx.argtmpPool.next()           // ★R6a: round-robin 8-slot pool,$S<scope>.argtmp<k> k=0..7;超界 throw LiteralSpillRequired(提示作者外置大常量到 file/publicStore)
      moves.push(makeMove({kind:'literal', value: ref.value}, toSlot(reg)))
      addrs[name] = internalAddr(reg)
    } else if (ref.kind === 'input') {
      // 业务变量 $r_input_<key> → 物理 in slot (C6: 编译器生成 move)
      const physSlot = `$S${ctx.scope}.in${ctx.formalSpecIndex[ref.name]}`
      moves.push(makeMove({kind:'internal', name: INPUT_PREFIX+ref.name}, {kind:'internal', name: physSlot}))
      addrs[name] = internalAddr(physSlot)
    } else /* register kind */{
      // C6: $r_<name> 是业务变量名,不是物理寄存器名
      //  - dir='out': op 执行后 move 物理输出槽 → 业务变量
      //  - dir='in':  op 执行前 move 业务变量 → 物理输入槽
      const physSlot = resolvePhysicalSlot(name, dir, ctx)  // formalSpec.slotIndex → $S<scope>.in/out<k>
      if (dir === 'out') {
        moves.push(makeMove({kind:'internal', name: physSlot}, {kind:'internal', name: ref.name}))
      } else {
        moves.push(makeMove({kind:'internal', name: ref.name}, {kind:'internal', name: physSlot}))
      }
      addrs[name] = internalAddr(physSlot)
    }
  }
  return {moves,addrs}
}
```

**C6 关键变更**:register kind 不再直接把 `$r_<name>` 作为 OpEntry 的 input/output 地址。`$r_<name>` 是业务变量名(经验级命名连线),物理寄存器由 formalSpec.slotIndex 决定。编译器对每个 input 生成 `move(业务变量, 物理输入槽)`,对每个 output 生成 `move(物理输出槽, 业务变量)`。op 的物理寄存器对其他 op 不可见。

### bindInputs：改用 scope-aware slot；outputs materialization(P2 Step5)新增收尾 move

```typescript
function bindInputs(exp, ctx) {
  for ([k, spec] of Object.entries(exp.inputs)) {
    const slot = SLOT_PREFIX_IN(ctx.scope, exp.inputSlotIndexOf(k))     // formalSpec B-input slots
    out.push(makeMove({kind:'literal', value: intent.params[k]}, toSlot(slot)))
  }
}
// Step5(post-bindings,P2;compiler.ts compileExperience 尾部追加)
if (exp.outputs?.materialize ?? true) {       // R2/C5:persistent outputs 落 publicStore
  for ([outKey, binding] of Object.entries(exp.outputs_bindings ?? {})) {   // ★新 schema 字段,显式声明"哪个 $out_k 是经验最终返回值"——不再靠猜最后一条 step
    entries.push(makeMove(from=toSlot(binding.register /*$scope.out<k>*/), to={kind:'public', name:`${exp.id}.${outKey}`}))
  }
}
```

**为什么需要 `outputs_bindings` 而不是自动推断?** —— doc D-E2-1 的 resolveResponse 今天已经在用 `$r_path`(D-4 缺陷修复后改名 $path)+ PRIMARY_OUTPUT 硬编码表;P2 起改为读 `exp.outputs[key].register`(formalSpec C-slot 编号)→ 业务 key↔物理 slot 有唯一映射源,**PRIMARY_OUTPUT Record<string,string> 可删**。若允许 compiler "取最后一个 write 到 out0 的值当返回",两条分支(then/else)各自写不同 slot 时会歧义(safe_write abort branch evaluate_expr(literal 0→$out0) vs do_write file_write($out0=$bytes)其实恰好同名安全,但通用性差)。显式 bindings = T4 元数据消费方的第一个真实用例。

### compileBranch：条件 scratch + conditional_skip.conditionAddr 指向 judge slot

```typescript
function compileBranch(j, thenEntries, elseEntries, ctx){
  const condReg  = `${ctx.scope}.cond_${j.id}`    // global-scope pool(R6a 同款,argtmp+conditional/judgment scratch 共用同一字面量装载池,≤8枚足够覆盖 MVP J≤5×3=15?——不,J=judgment数量上限建议≤5 per experience → need ≥ 2J slots;改 argtmpPool size=16 or 拆两个独立池:literal-pool(8)+judge-pool(J*2≤10),总量仍 ≤18 < U_max~20 ✓)
  const judgeReg = `${ctx.scope}.judge_${j.id}`
  return [ move(negatedAST_literal → toSlot(condReg)),   // R6a pool
           {kind:'execute_op',operation:'evaluate_expr', inputs:{expr:internalAddr(condReg)}, outputs:{result:toSlot(judgeReg), error:GLOBAL_ERR}},
           {kind:'conditional_skip', conditionAddr: internalAddr(judgeReg), n: lenMarkedT+1}, ... ]
}
```

**U_max 重新核算(C1)**：Global{$err,$path}=2 + literal pool(8)+ judge/cond pool(per-experience max 10，但同 experience 内串行、不同 frame scope 隔离 → **活跃数=max(单experience最大并发条件判断)≈J_max≤5 → 2×5=10**) + in-slots(M_max=5) × max_concurrent_scopes + out-slots(P_max=3) × max_concurrent_scopes。
- **P4/T-4.3 调整**：`MAX_ACTIVE_SCOPES` 从 8 提到 1024（匹配 `DEFAULT_MAX_RECURSION_DEPTH=1000` + 余量），允许递归经验深度嵌套。U_max 理论上限 = 2+8+10+(5+3)×1024 = 8202。
- **P4 实测**：全量 e2e + demos 实测 `internalStore.size()` peak = **12**（远低于理论上限 8202），记录在 doc 19 N4。
- **`$r_*` 全局化决策**：P4/T-4.3 中 `$r_*` 寄存器名在 new path 下保持全局（不 scope-prefix），支持递归经验（如 count_to）通过 `$r_cur` 跨帧共享状态。formalSpec outputs 仍通过 slotIndex scope-prefixing，但当 ParamRef.name 是 `$r_*` 时用原名。`$r_err`→`$err`、`$r_path`→`$path` 由 `expandRefs`/`resolveVar` 解析。
- **U_max 最终值**：保留 `U_MAX_P1_ESTIMATE=8202` 为理论上限 bound，实测峰值 12 为运行时观测值。

---

## 四、C2(R3):嵌套 params register 引用落地(P3)

### ParamRef 扩展
```typescript
export type ParamRef =
  | { kind:'literal'; value: Value }
  | { kind:'input';   name: string }              // A 入参透传(input slot 引用,C3 fixed index)
  | { kind:'register'; ref: { exp?: string; outKey: string } }   // ★新增结构化引用:{exp=父frame experience id或'*'(最近祖先), outKey=该experience outputs bindings 里的业务key}
      // P3 MVP:ref.exp='*'表示"直接父 frame",不跨层查找(保持单层 CALL/RET 语义);P4+可扩展为显式 expId 链
```

### makeNestedIntent(P3):不再 throw register kind,而是产出 deferred binding
```typescript
function makeNestedIntent(step, ctx){
  for ([k, ref] of Object.entries(step.inputs)) {
    if (ref.kind==='register') {
      const parentBinding = resolveParentOutput(ctx, ref.ref)   // 查父experience.outputs_bindings[ref.outKey].register → '$S_parent.out<k>' + formalSpec.type 做 C2 编译期类型校验(§二 C5/T4 联动)
      params[k] = { __slotRef: parentBinding }                 // B.bindInputs 看到 __slotRef 时生成 move(from=$S_parent.out<k>, to=S_child.inK_of_B_input_k)，而不是 literal
    } else …/* literal/input 同前 */
  }
}
// B.compileExperience Step0 bindInputs 增加分支:
if ('__slotRef' in paramValue) moves.push(makeMove({kind:'internal',name:paramValue.__slotRef}, toSlot(SLOT_PREFIX_IN(childScope, slotIndexOfB(k)))) )
else                          moves.push(makeMove({kind:'literal',value:paramValue},       toSlot(…)))
```

**为什么这样能解决"值 vs 引用"的静态快照问题?** —— 今天 D-1 断裂根因是 `ctx.intent.params[A参数名]` **在 A compile 时刻就取出了具体 JS value**(死值),塞进 B.params;P3 后 register kind 不取值、只记录 `$S_parent.out<K>` 这个地址,B dispatch 时才 resolve——与 L1 execute_op 读 internalStore 的动态语义对齐(CALL/RET + caller-saved registers 模型)。

### C2 编译期类型校验(T4 联动,可选 P3.5/P4)
resolveParentOutput 返回 {register, type=exp.outputs_bindings[ref.outKey].type};若 B.inputs[k].spec.type 与 type 不兼容(string↔number/path…)→ throw ParamRefError(`A.${outKey}:${type} not assignable to B.input_k:${expected}`)。这是 doc T4 "ParamSpec.type 编译期校验(当前不查)" 的第一处真实落地。

---

## 五、R6a:literal / scratch pool(消灭 D-1 argtmp 无界增长)

```typescript
class SlotPool<T extends string = number> {   // MVP:T=string(scopePrefix+suffix模板);实际实现简化为固定大小数组轮转即可
  private cursor = 0
  constructor(private size: number, private nameGen:(k:number)=>Address) {}
  next(): Address { const a=this.nameGen(this.cursor); this.cursor=(this.cursor+1)%this.size; return a }   // round-robin,同 scope 内重访时自动覆盖旧值
}
// ctx.literalPool    = new SlotPool(8,  k=>internalAddr(`${scope}.argtmp${k}`))     // R6a literal sidecar
// ctx.judgeCondPool  = new SlotPool(J_max*2 /*≤10*/, (k)=>internalIdx(`${scope}.${k%2?'judge':'cond'}_${j.id}_${Math.floor(k/2)}`))  // per-judgment 专用槽位(不混用,便于 debug trace 可读性)
```
**为什么 round-robin 安全?** —— op.execute 一次读完全部 inputs(resolveInputs Step4 在 dispatch in 瞬间同步完成),期间没有 yield point 让另一 step 插入覆写同一 slot;跨 step 的 argtmp 复用天然无冲突(x87 FPU stack / ARM NEON V-registers 同理)。唯一边界 case:**同一 OpEntry.inputs 里两个不同参数都是 literal** → expandRefs 顺序 push 两条 move(literal→pool[0], literal→pool[1])再一条 execute_op,两 move 先后执行、互不依赖 ✓。若未来出现"需要同时持有 >size 个未消费字面量"的场景(MVP 不存在),超界 throw `LiteralSpillRequired`(提示作者把大常量外置 file/publicStore——C5 正好提供落地点,R6b const table 是其长期方案)。

---

## 六、Walkthrough：R5+P3 生效后的 safe_write（对照现状逐条 diff）

```
S0 = SCOPE_ROOT (safe_write frame, P1起 L4/Layer4根意图也是 S0)
① bindInputs(S0):  move(path_literal   → $S0.in0)     ← 旧:$r_input_path(硬编码字符串)
                   move(content_lit    → $S0.in1)      ← 旧:$r_input_content
② pre.file_read:    {inputs:{path:$S0.in0}, outputs:{content:$S0.out0, error:$err}}  ← 旧:$r_existing/$r_err
                  dispatch in → internalStore[$S0.in0]=A.path → op.execute() → set $S0.out0='hello',set $err=null → pop
③ judgment compileBranch('already_exists'):
   [0] move(not(is_null($err))_AST_literal → $S0.cond_already_exists)     ← R6a literal pool slot(k=0轮转)
   [1] execute_op(evaluate_expr,{expr:$S0.cond_*, result:$S0.judge_*,$err}) env={'$err':'$err'}★显式填充(D-5修复)
   [2] conditional_skip(conditionAddr=$S0.judge_*, n=lenMarkedT+1)        ← 读 judge truthy,分支语义不变(§四 D-C4-3 取反构造保持)
   …THEN(mark $path='abort'→do abort path)/ELSE(do_write path)按现有编译规则生成…
④ target.do_write step file_write: inputs{path:$S0.in0,content:$S0.in1} outputs{$out0,$err}(同物理slot复用in0/in1——C3跨step轮转✓;out0在②已被file_read占用,但file_write dispatch in瞬间才move/execute、与②无重叠执行窗口 ✓)
⑤ (P2/R2 Step5 post-bindings): safe_write.outputs_bindings={bytes_written:{register:'$S0.out0',type:'number'}}
   → move($S0.out0 → publicStore['safe_write.bytes_written'])             ★C5 首个真实写入点
⑥ processIntentEntry awaiting_children→done: exitScope(S0)(FrameScopeAllocator.pop(),counter--);recursionDepth.exit('safe_write') — **顺序:先scope pop后frame done?需定稿:**建议 scope.pop()紧跟exitIntent同调用点(main-loop.processIntentEntry done分支),保证异常冒泡路径(bubbleError Step4/5 abortFrame)也走同一出口不泄漏(P1测试重点)

若 B 嵌套调用(A.call_b 场景,P3):A.scope=S1,B.scope=S2(B.bindInputs生成 $S2.in0←__slotRef'$S1.outK'的move)
```

**对照现状**:寄存器名从"手工业务字符串+argtmp_N自增"变为"$S<scope>.in/out<k> + global{$err,$path} + bounded pool";**U_max有界(C1达成)**;B能拿A中间产物(C2,CALL/RET caller-saved convention落地);formalSpec slotIndex与实际Address.name一一对齐(D-3兑现,RegisterAllocator复活为FrameScopeAllocator)。

---

## 七、分阶段实施计划 & 风险清单

| Phase | Scope | 关键变更文件 | 验收标准(对应需求文档 C#) |
|-------|-------|-------------|---------------------------|
| **P1** R5.2/R5.3/C3+C1主体 | FrameScopeAllocator(scope prefixing)+ formalSpec加`slotIndex`(operation.ts schema)+compiler全部改用$S_scope.in/k命名(literal池R6a size=8,judge/cond池size≤10)+ evaluate_expr env显式填充(R5.4/D-5)+ 旧名($r_err/$r_path→$err/$path)双写别名过渡期 | execution-state.ts(FrameScopeAllocator替代现有类)、types.ts(SLOT_*常量/deprecated alias)、experience.ts(FormalParam.slotIndex?——实际是Operation.formalSpec升级,见下)、compiler.ts(expandRefs/bindInputs/compileOp/makeNestedIntent/compileBranch全面改造)、l1/primitives/*.ts基本不动(execute-op只认internalStore字符串✓)、evaluate-expr.ts(formalSpec.env.register改'$in1'规则一致) | tier-a/c/b e2e全绿;新增断言 test: `expect(state.internalStore.size).toBeLessThanOrEqual(U_MAX_P1)` U_MAX_P1=P1实测值暂定为76(§三核算),P4固化;demo-06嵌套跑通;legacy mode开关(useFixedSlotConvention=false时走旧路径,P1保留一迭代作对照测试基线再删) |
| **P2** R2/C5 outputs materialization + persist hook | experience.ts(outputs_bindings schema / ParamSpec.persist?)、compiler.ts Step5 post-bindings move生成、pipeline.ts collect()去PRIMARY_OUTPUT硬编码表(resolveResponse同步读outputs_bindings.type做插值校验,可选T4联动)、main-loop processIntentEntry done+pop处scope pop时机定稿(与exitIntent同调用点,bubbleError abortFrame对称处理) | 同上+response.ts(GLOBAL_PATH引用改名) | pipeline.collect行为不变(E2消息正确);safe_write/read_file_with_default的publicStore出现`<expId>.<key>`条目(C5首个落地点);未声明bindings的经验不污染publicStore(回归保护);resolveResponse P2起从$path+outputs_bindings反查模板,不再依赖PRIMARY_OUTPUT Record |
| **P3** C2/R3 register引用in nested params | experience.ts(ParamRef新增register kind结构化ref {exp,outKey})、compiler.makeNestedIntent(产出__slotRef deferred binding而非throw)+bindInputs(B侧move from $S_parent.outK to S_child.inK)+ resolveParentOutput helper(父experience bindings查表+type check抛ParamRefError,C2编译期类型检查T4首落地,demo-06加A→B中间产物传递e2e用例 + 负例:类型不匹配/悬空outKey) | compiler.ts核心改造(experience-library现有9条经验若含跨步register需求则顺带迁移,P3前无此场景——replace_in_file三步链($r_content/$r_replaced都是step内寄存器引用,走同scope内formalSpec slot复用,不需cross-frame ref;真正跨frame demo由新测试构造) | C1不变(U_max已锁定);C2验收:test A.file_read.output.content → B.string_replace.input.text真实传值;$err传播路径回归(bubbleError仍读global$err,与C2正交✓) |
| **P4** ✅已完成 R6b const table / U_MAX实测固化到doc / legacy mode删除 & alias清理 | T-4.1: 不需要 const table（实测峰值12<<理论8202）;T-4.2: 实测峰值=12，保留 U_MAX_P1_ESTIMATE=8202 为理论上限;T-4.3: legacy mode 已删除（`crrNewPathEnabled()` 始终 true），`enableCrrNewPath()`/`disableCrrNewPath()` 保留为 no-op shim;`$r_*` 寄存器名在 new path 下保持全局（不 scope-prefix），`$r_err`→`$err`/`$r_path`→`$path` 由编译器解析;T-4.4: doc 同步更新 | errors.ts、main-loop.bubbleError、pipeline/response、compiler.ts、expr-env-builder.ts、experience-service.ts | 670 tests passed / 41 files passed / typecheck + build green |

### 风险清单（按等级）

| # | 风险 | 等级 | 缓解措施 |
|---|------|-----|---------|
| R-1 | **scope pop 时机与 bubbleError abortFrame 路径不对称** → 递归计数器/scope 计数不平衡(A11 现有 enterIntent/exitIntent 已证明这个坑存在过) | 🔴高 | P1 起在 FrameScopeAllocator.push/pop 处加 assert(counter≥0 / ≤MAX);bubbleError Step2/4/5 三处调用 abortFrame 统一走 `releaseScope(entry)` helper(内联 exitScope+recursion.exit),禁止两处独立维护;新增 tier-a11-recursion 同构测试(scope depth vs recursionDepth 对齐断言) |
| R-2 | formalSpec.slotIndex 引入后,**存量9条经验的 OpEntry 生成逻辑全改**,回归面大 | 🟡中 | useFixedSlotConvention feature flag(P1默认false跑legacy对照,P1末翻转true重跑全部tier-a/b/c/d/e + demos/*.ts人工review demo-05-l3-compiler/demo-06-nested-experience的输出diff,预期仅Address.name字符串变化、执行轨迹语义不变) |
| R-3 | argtmp pool round-robin 的"单 step 无并发读写同一 slot"假设,若未来某 op.formalSpec.inputs>size(8枚)或出现 await yield point(op.execute非纯函数)会破坏 | 🟡中 | MVP 强制 M_max=4 < pool size=8 留出余量;op.execute契约文档显式声明"不yield"(与现有formalSpec自洽性原则D-T7一致);P4 const table(R6b)是彻底解耦方案,先记待处理项 |
| R-4 | C5 publicStore persist 若被滥用 → publicStore膨胀(每经验都写public),失去"瞬态寄存器 vs 持久业务数据"双区隔离初衷(doc D-T1) | 🟢低 | P2起 `persist` 标记默认false(opt-in);demo/测试只允许 ≤2条经验开persist验证机制;doc里加反模式警示("不要把每个中间结果都persist——那是internalStore该干的事") |
| R-5 | evaluate_expr env map(D-5修复)需要 compiler 静态收集AST var引用并反查slot绑定,**condition_expr里可能出现experience作者手写自由字符串**(如'$r_content'这种旧业务名而非slot index)→ resolveSlotFor反查失败 | 🟡中 | P1迁移期:resolveSlotFor做双向兼容——优先按outputs_bindings/formalSpec.businessName精确匹配,未命中时fallback到旧全局$err/$path特判+**编译警告**(console.warn + trace日志记录),给9条存量经验的condition_expr一个review窗口(P4前清零所有warning后才算D-5真正闭环);长期方案:P3 register引用结构化({exp,outKey})后,var.name统一用businessName,schema层面杜绝自由字符串 |

---

## 八、与既有文档的同步清单（P0 评审通过后逐个更新）

| doc | 章节 | 变更内容摘要 |
|-----|------|-------------|
| [doc 06](./06-execution-layer.md) §三.3.2 execute_op规范 / §四 Address模型(双区)/§六数据区 | inputs/outputs slot约定($S_scope.in/out<k>替代"必须是internal"的模糊描述)+ formalSpec加slotIndex字段定义+$in*/$out*池大小上限M_max/P_max常量出处 |
| [doc 10](./10-reactive-execution-model.md) §二数据结构(StackEntry OpEntry.inputs类型注释)/§四L3Service契约(compile签名透传ctx.scopePrefix说明)/§五Op错误处理策略($r_err→$err改名注记,行为不变) | 同左;重点标注"CALL/RET scope switching由FrameScopeAllocator承担,execute_intent primitive本身零改动"——这是R5最容易被误读为"L1要改dispatch逻辑"的地方,实际只有compiler生成名的规则变了 |
| [doc 12](./12-experience-model.md) §六三段式编译流程(D-C4系列步骤表) | Step0 bindInputs改为scope-aware in-slot绑定+新增Step5 post-bindings(outputs materialization,R2/C5);D-C6-1待办项正式升级为C2契约(register引用结构化ref schema);experience.outputs_bindings新schema章节 |
| [方向文档 doc 13](./13-next-directions.md) D2/T4条目 | D2从"缓行"提升为P3落地里程碑(本文档C2);T4首个消费方=P2 outputs_bindings.type校验 |

> **评审 checklist(P0)**:① C1的U_max估算值76是否接受为临时上界(还是要求P1就给精确值)? ② M_max/P_max=4/3对现有9条经验够用吗(file_write有path/content两input→in0/in1✓;evaluate_expr有expr/env→需要$in0/$in1两slot ✓;glob_match pattern/path/cwd→in0/in1/in2 ✓ P_max out matches/count/error=$out0/out1+$err ✓——**初判9条全够,但需逐条过一遍formalSpec确认无第5个输入参数的op**,此为本设计最大潜在返工点)。③ FrameScopeAllocator替代RegisterAllocator是否保留旧类名作为deprecated re-export一个迭代(import diff最小化)。
