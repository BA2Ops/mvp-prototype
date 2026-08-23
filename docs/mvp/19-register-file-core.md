# 核心需求：寄存器文件重设（CRR）— Capability Baseline

> **状态**：Draft v0.2（待评审）
> **日期**：2026-08-22
> **范围声明**：本变更是 L3/L1 之间数据传递机制的一次阶段性重构，目标是兑现 doc 里反复承诺的 RISC/CPU ISA 类比——从「字符串命名 + 无界增长」升级为「固定宽度 slot + CALL/RET scope prefixing」。本文档只回答**必须支持什么能力**；怎么做到见 [详细设计](./19b-register-design.md)；**怎么落地、先后顺序、谁依赖谁**见 [实施计划](./19c-implementation-plan.md)。

---

## 背景（一句话）

当前实现下,internalStore 实际是无界的 Map<string,Value>,由三股力量共同造成膨胀:①literal sidecar `$r_argtmp_N` 单调自增;②经验作者手工硬编码业务寄存器名(`$r_content/$r_matches/…`)且跨经验同名覆盖;③register 引用 kind 直接 throw(D-C6-1/D2 未落地),导致 A→B 只能传 literal/input 快照值。**子经验无法拿到父经验的中间结果与最终输出**,是当前最尖锐的功能缺口。

---

## 本次变更必须支持的 5 项核心能力(缺一不可)

### C1 — Bounded Register File(有界寄存器池)

运行时 `state.internalStore.size()` 峰值 ≤ 可预先计算的常量 **U_max**(MVP 建议值 ~76,P4 实测固化),与执行步数 / op 调用次数无关、不随经验库规模线性增长。

*验收*:任意合法嵌套链(A→B→C…,深度≤maxRecursionDepth=8 MVP)跑完前 internalStore size 断言通过;tier-c e2e 全过 + 新增 size ceiling test。  
*现状对照*:今天无界——argtmp counter 跨 compileExperience 不 reset,累计字面量数即上限下界。

### C2 — Nested Params Support Register Reference(子经验可读父经验产物)

`ParamRef` 的 `kind:'register'`(结构化 ref `{exp?, outKey}`)正式支持:A 在处理过程中写入内部数据区的所有具名产物(pre-processing 输出 / target step 中间变量 / outputs_bindings 声明的最终返回值)都能被其调用的子经验 B **按业务名引用**;dispatch 到 B 时才 resolve(CALL/RET caller-saved convention),类型不匹配 → 编译期 `ParamRefError`。

*验收*:demo-06-nested-experience 加 A.file_read.output.content → B.string_replace.input.text 真实传递用例;负例:类型不兼容 / 悬空 outKey throw ParamRefError;替换现有 makeNestedIntent 对 register kind 直接 throw 的行为(D-C6-1/D2 待办项本体)。  
*关键语义*:不再是"值快照拷贝",而是 deferred binding —— B.bindInputs 生成 `move(from=$S_parent.outK, to=S_child.inK)` 而非 literal move。

### C3 — Fixed Slot Convention + Frame Scope Prefixing(跨指令复用固定槽位,CPU ISA 对齐)

每条 L2 op 通过 formalSpec.slotIndex 拥有固定的 `$in<k>`/`$out<k>` slot 编号(M_max=4 / P_max=3);**同一物理槽位在 op dispatch in→done+pop 窗口内稳定归属该 op**,不同 op/经验可先后使用相同 slot。**消灭 argtmp_N 自增模式**。CALL/RET 隔离靠 frame scope prefixing($S<scope>.*)由编译器闭包捕获 currentScopePrefix,**L1 Address/execute_op/move primitive 零改动**(只认字符串)。

*验收*:两条共享 file_read 的经验生成的 OpEntry inputs/outputs Address.name **完全相同**(除 scope prefix);internalStore.size() ≤ U_max(R5.3 §三核算);formalSpec.register('$r0'/$r1…)与实际使用的 $S_scope.in/out 名一一对齐(D-3 兑现——今天 [RegisterAllocator](../../src/l1/execution-state.ts) 定义在 L1、暴露给 L3 却从未被 compiler 调用过)。  
*CPU 类比落地*:通用寄存器号不变,frame 切换 = effective address bank-select(x86 segment:offset / ARM NEON V-register bank),caller-saved vs callee-saved convention 对应 input/output slot 的读写边界。

### C4 — Global Functional Registers(错误与路径标记保持全局单例)

`$err`(替代现有 `$r_err`,last-writer-wins,所有 op error output 共用)+ `$path`(D-E2-1 resolveResponse path marker)= 跨帧可见的功能寄存器枚举,MVP 固定 {$err,$path} + 预留 ≤6 空位。**不参与通用池复用** —— bubbleError / resolveResponse 对这两个名字的引用行为与今天一致(P1 仅改名对齐规范前缀,不新增语义)。

*验收*:bubbleError Step1 `state.internalStore.set(ERROR_REGISTER,…)` 仍命中同一物理槽;resolveResponse 读 `$path` 选分支消息的行为不变;$err/$path 不出现在 expandRefs/bindInputs 生成的 in/out slot 名里(scope prefixing 也不作用于这两枚)。  
*现状对照*:已满足语义(D-4 缺陷修复后 $r_err/$r_path 实际就是这种角色);P1 只改名+文档化枚举上限,防后续自由扩展(N6/N5 见下"明确不做")。

### C5 — publicStore as Cross-Intent Persist Channel(经验间持久通道落地)

Experience schema 新增 `outputs_bindings: {<key>: {register:'$scope.out<k>', type}}`(可选字段,P2 引入),compiler Step5(post-bindings)在 done+pop 之前生成收尾 move(internal → publicStore[`${exp.id}.${outKey}`])。这是多轮会话/经验链产物落地的最小机制,也是 pipeline.collect() 去硬编码 PRIMARY_OUTPUT Record 表的前置依赖(T4 元数据消费方第一例)。

*验收*(若采纳):safe_write/read_file_with_default e2e 跑完后 publicStore['safe_write.bytes_written'] / ['read_file.content'] 可读;未声明 bindings 的经验不污染 publicStore(opt-in,persist:true 默认 false —— MVP 双区隔离 D-T1 初衷保留);"每句新 state"的对话级隔离性保持(P0 前行为不变)。  
*现状对照*:publicStore 今天存在但**零写入点**(address-resolver.writeAddress kind:'public' 分支可达、全代码库无产生路径)——C5 是它的第一个真实消费者。

---

## 关键预期与不变量(C1' —— 多请求隔离 / scope 独立性与峰值语义)

> **本节固化评审中反复确认的隐性假设**。它们不新增能力,而是给 C1/C2/C3/C4 划清边界;若未来改动打破任一条,必须显式更新本节 + design §三/U_max 核算口径,而非静默失守。详细论证见 [design §三 U_max 核算](./19b-register-design.md)(“R5.2 — Slot Allocation Rule”下方 “U_max 重新核算(C1)”子节)、§七风险清单 R-1(scope pop/bubbleError 对称性)/R-3(argtmp pool round-robin safety)/R-5(evaluate_expr env fallback warning)。

### K1 — 每个 L3/L1 外部发起的请求持有独立的 L1 运行时实例,internalStore/publicStore/recursionDepth 互相分割隔离

- *事实依据*:[pipeline.ts say()](../../src/l4/pipeline.ts)每次 `createInitialState(registry, service)` → internalStore/publicStore/stack/recursionDepth/allocator **全部 fresh at start**;只有 l2(L2Registry)/l3(ExperienceService)被共享,但两者都是不可变字典(Map lookup only),不是可变数据区。
- *推论*:两个并发 say()(如 HTTP server 同时处理多用户)各自 peak size ≤ U_max,**互不破界**——即使都走 `$S_scope.in0` 也是不同 Map key。**跨请求的 slot name 无 aliasing bug**。
- ⚠️ *失效条件*(防回归):若 P4+/方向 B(F EC Environment Context、R6b const table)引入模块级单例 allocator/scope counter / 全局资源池 → 跨 request scope trees 叠加计入 active_scopes → **U_max 核算口径失效**(design §三 ×8 假设的是"同一 state 内最深递归帧数",非跨 request 总量)。届时必须重新声明新的隔离边界并更新本节 K1 + N5。

### K2 — "子经验同步执行"在 MVP 下 = 深度优先串行 CALL,无真·并行窗口;故 C1/C3 的所有有界性论证均成立

- *事实依据*:[main-loop.ts](../../src/l1/main-loop.ts#L306-L339) `while (state.stack.length>0)` 单线程 dispatch,一次只取栈顶一个 entry。execute_intent(A→B)= "保留 A 帧、把 B children push 到 A 之上",直到 B done+pop,A 才恢复 —— 任何瞬间只有最深那个 frame "正在运行",不存在两个 execute_intent 同时处于 pending/dispatching。
- *现状佐证*:目前唯一真实的多经验协作场景是 [tier-d setup_workspace](../../tests/phase-d/tier-d-scenarios.test.ts)(safe_write → write_file → replace_in_file → read_file 四条核心经验的编排),仍是嵌套 CALL 串行展开,非 Promise.all / 工具池并发。
- ⚠️ *失效条件*(防回归):若未来引入真·并发(Promise.all 跑两条独立子经验、方向 F 应用化的异步工具池等)会打破 K2 —— **此时 U_max ≈76 的 ×maxConcurrentScopes=8 封顶假设不再适用**(并发分支各自持有 scope slot,total size = Σ_各并发树 peak)。建议在那时另立 doc(或升级 N5/N7),不要在本 CRR P1–P4 范围内悄悄扩展。

### K3 — U_max ≈76 已显式纳入"父子寄存器栈随深度线性叠加"这一项;天花板由 maxConcurrentScopes(A11 RecursionDepthError 同源机制,MVP 软限默认 8,可配)钉死而非靠"恰好不深递归"

- *事实依据*:[internalStore](../../src/l1/address-resolver.ts)是**一份共享 Map**,scope prefix($S<depth>.*)只是给 key 加字符串前缀,**不同深度的同名 slot($S1.in0 vs $S2.in0)是两个物理不同的 Map entry**。故 total size ≈ Σ_{每层 depth} (该帧 in+out slots + judge/cond scratch),**随嵌套深度线性增长**;U_max ≈ 2(global)+ 8(literal pool)+ 10(judge/cond pool)+ 8×(M_max 4 + P_max 3)= **≈76**,design §三核算口径一致,P4 实测固化(N4/R6b const table 备选方案视峰值决定是否进一步压低)。
- ⚠️ *关键不变量*:A11 [RecursionDepthError](../../src/l1/recursion.ts)(DEFAULT_MAX_RECURSION_DEPTH=1000 现状,CRR MVP 建议并列检查 `maxConcurrentScopes = min(maxRecursionDepth, 8)`)**必须继续作为 C1 的运行时守门员** —— 它保证"活跃 scope trees ≤8"这个 U_max 上限的前提条件;若未来调高 maxRecursionDepth 而未同步更新本节 K3 / design §三 ×8 系数,U_max 即静默失守。scope pop/bubbleError abortFrame 不对称(R-1🔴高风险项)是这条链上唯一可能被运行时打破的通道,P1 重点测试覆盖(design §七 R-1)。

### K4 — "父子寄存器栈独立"分两层理解:CRR Draft v0.1 已达成逻辑独立(scope prefix),物理回收复用是 P4+ 可选项而非本期阻塞项

| 维度 | 现状(MVP + CRR Draft v0.1) | CPU 类比理想态 |
|---|--------------------------|---------------|
| **命名空间隔离** | ✅ $S<scope>.in/out —— 父 A($S1.*)与子 B($S2.*)互不可见同名槽位,**无 aliasing bug**(C3/CALL-RET convention 的本体兑现) | x86 segment:offset / ARM NEON banked registers |
| **生命周期回收** | ⚠️ A 帧 done+pop 时,$S1.* 的值仍残留在 internalStore(只是没人再读它,直到后续 move 到同一字符串 key 才被覆盖);Map entry 本身不会被主动 delete | x86 CALL/RET 的 callee-saved register save/restore —— 退出 frame 时应把 slot 归还池、下次 dispatch in 重新分配,**而非永久占用一个 Map slot** |
| **全局功能寄存器例外(C4)** | $err/$path **故意不 scope**,跨帧共享(bubbleError/resolveResponse 依赖此不变量)—— **刻意的非独立性,不是缺陷**;若误读为"父子栈应完全独立",会破坏 C4,需在本节显式声明避免评审歧义 | FLAGS/CPSR 同样跨调用边界可见 |

*结论*:MVP 阶段选择 **先保证正确性(isolation)再优化峰值(reclaim)** 是合理取舍 —— isolation 错了 U_max 断言能抓到(test fail),reclaim 缺失只是内存指标问题(P4 实测后决定是否值得加 reclaim/push-pop 复杂度,demo-05-l3-compiler/tier-d setup_workspace 递归场景为主要压测点;design §五 R-3/R-5 + N4 R6b const table 同思路可一并压低 judge/cond scratch 峰值)。本节 K4 明确:**本期验收只看逻辑隔离正确性,C1 size ceiling 允许含未回收残留(只要 ≤U_max≈76),不把物理 reclaim 设为 P1–P3 阻塞项**。

### K4a — "跨较长指令序列 / 多个子经验复用同一 parent output slot"的边界条件(实现目标 + 验证目标)

> **场景来源**(2026-08-21 评审):`A.file_read.output.content` 可能被 (a) A 自身 steps[] 后续多条 op 先后消费(read→replace→verify…),或 (b) A 调用的**多个子经验 B₁/B₂…Bₖ**各自作为 input 引用(每个 CALL Bᵢ 都 bindInputs copy 一次)。
> **核心结论**:K2/K4 scope retention(A pending→done+pop window)= CPU caller-saved convention,**天然保证父 frame out-slot 在整个 CALL chain 期间存活且不被覆写**(除非同 experience 内另一条 step 显式 alias 同一 $S_A.out_k —— caller-saved 约定下这是合法且预期的,见 [execute-op.ts Step6 writeAddress](../../src/l1/primitives/execute-op.ts#L97-L105));因此**无需为"长链路/多引用"把 content move 到 publicStore(业务变量区)**。move→public 只属于 C5 persist opt-in(K5/N5 跨 frame/cross-turn 持久化),不是本场景的解法。**误标 persist:true = R-4🟢低反模式 + K5 growth-channel 污染**。

#### 实现目标(P3 register-ref deferred binding 落地后)

| # | 目标 | 归属 Phase / doc |
|---|------|----------------|
| G1 | `replace_in_file`(MVP 唯一真实的"一条经验内、content 被多个 step 先后消费"场景:file_read.content → string_replace.text → file_write.content)在 CRR P1 fixed-slot convention 下改为 **$S_A.outK aliasing**,全程不产生额外 `$r_argtmp_N` sidecar move(content 走 out slot direct ref,不走 literal pool);三步链 internalStore.size() 峰值较现状降低(literal pool round-robin ≤8 而非每步新增 entry) | design §四 Walkthrough(diff safe_write 同理推广到 replace_in_file 五步扩展版,P3 压测点);tier-c tier-d e2e |
| G2 | A.file_read.output.content 被 B₁/B₂…Bₖ(≥2个)**各自 CALL bindInputs copy 一次**(caller-saved convention):每次生成独立 $S_Bi.in<slot> move,**源 $S_A.outK 不被覆写、值跨多次引用一致**;A.frame retention window(processIntentEntry pending→done+pop,K4 scope prefix)覆盖全 chain,MVP K2 串行 CALL 下天然成立 | [makeNestedIntent](../../src/l3/compiler.ts#L350-L376)(P3 register kind deferred binding)+ [bindInputs](../../src/l3/compiler.ts#L159-L177)(B 侧 `__slotRef` → makeMove from=$S_parent.outK to=S_child.inK);design §四 "R3: nested params support register reference" 小节新增 **多子引用复用同一父 output slot** 用例(tier-d setup_workspace 扩展版:safe_write.content / read_verify.content 先后两步,非并行 fan-out —— MVP 严格串行,CALL/RET stack depth = max(N_steps),不是 Promise.all) |
| G3 | CRR Draft v0.1(P2 post-bindings Step5)对 **outputs_bindings.materialize/persist:true(opt-in,默认 false)** 的经验,A done+pop 时追加 `move($S_A.outK → publicStore['A.<key>'])`;**未声明 persist 的 A**(如 replace_in_file/safe_write)不污染 publicStore(K5 growth channel + D-T1 dual-store isolation 初衷保持)——G1/G2 场景全程 internal-only,**不需要为"长链路/多引用"额外 move→public** | P2 design §三 R5.4 bindInputs/post-bindings;pipeline.collect() 读 exp.outputs_bindings(去 PRIMARY_OUTPUT 硬编码 Record<string,string>)|

#### 验证目标(tier-c/tier-d e2e,P3 验收必过项)

| # | 断言 | 说明 |
|---|------|------|
| V1 | `replace_in_file` 五步扩展用例(file_read→string_replace→grep_check→file_write→read_verify,file_content 被 ≥3 个后续 step 引用):每步 resolveInputs(`state.internalStore.get('$S_A.out<slotIndex(content)>')`)读到同一值;internalStore.size() peak ≤ U_MAX_P1(design §三核算口径,不因 chain length 线性增长 —— **literal/judge-cond pool round-robin size=8/10 封顶,K3 ×maxConcurrentScopes≤8**) | tier-d-scenarios.test.ts 现有 setup_workspace(safe_write/write_file×2/replace_in_file/read_file)基础上加 read_verify/grep_check 两步骤复用 $r_content→$S_A.outK 的链式消费场景,新增 internalStore.size ceiling assertion(P3 引入 K3 软限 maxActiveScopes=8 后同步启用此断言) |
| V2 | A.content 被 B₁(如 replace_in_file.step_string_replace)+B₂(假想的 verify_read step)先后引用:两次 makeMove(from=$S_A.outK, to=$S_Bi.inK)**源同址、目标异址**,执行顺序严格串行(K2),**B₁ in-slot copy ≠ B₂ in-slot copy 物理地址不同(scope prefix 隔离),但读到的 value 一致且等于 A.file_read op.execute 返回的原始 content**(无中途覆写污染);额外断言 `expect(internalStore.get('$S_B1.in<slotText>')).toBeSameValueAsBefore` after B₂ execution finishes(K4 retention window 覆盖全 CALL chain,B₁/B₂ frame 都在 A frame 之上,retention 天然成立 ✓ —— **MVP 不测 Promise.all fan-out,K2 失效条件另立 doc**) | tier-d-scenarios.test.ts setup_workspace 扩展版(G2):safe_write → read_verify(B₁)/replace_and_log(B₂)两步各自 bindInputs copy A.content,**断言两次 copy 值 === fileReadOp.execute().content(同一 fs fixture 内容)**,而非仅"非空/类型正确"——这是 caller-saved convention 正确性的直接验证 |
| V3 | C5 persist opt-in 回归保护:`persist:false`(默认)的 A(G1/G2 全部场景)跑完后 `publicStore.size()===0`;显式标 `persist:true` 的经验(safe_write/read_file_with_default,P2 e2e 已验收 G3)才出现 `<expId>.<key>` entry。**反模式警示注释**加进 experience-library.ts 顶部 header + design §五 R-4:"不要把每个中间结果都 persist —— 那是 internalStore 该干的事;G1/G2 这类同 experience 内 step-chain / 多子引用复用父 output slot 的场景,**禁止**为它们打开 persist:true(会污染 K5 growth channel)" | P2 起 tier-c e2e safe_write/read_file_with_default publicStore assertion 保持现有行为不变(P2 已覆盖);G1/G2(tier-d replace_in_file/setup_workspace)**新增** `expect(Object.keys(state.publicStore)).toEqual([])` 作为反向断言,确保开发者不会误把 chain-intermediate 值标 persist |

#### ⚠️ MVP 边界(防范围蔓延,K2 失效条件触发时的处理)

本节 G1–G3/V1–V3 全部基于 **K2(MVP = 深度优先串行 CALL,无真·并行窗口)**。若未来引入 Promise.all fan-out / 异步 op.execute(方向 F 应用化),caller-saved convention 仍成立(B₁/B₂ in-slot copy 互不干扰,K4 scope prefix isolation ✓),但 V1 的 "internalStore.size() peak ≤ U_MAX_P1 不因 chain length 线性增长"假设需重算(total size = Σ_并发树 peak,×maxConcurrentScopes=8 不再适用)——届时另立 doc(N5/N7? 建议归入方向 B EC 或 CRR v0.2)声明新的峰值核算口径,**不要在本 P0–P4 范围内悄悄扩展 K3/K4 论证基础**。design §五 R-1(scope pop/bubbleError abortFrame 对称性🔴高)+ R-3(argtmp pool round-robin safety🟡中)已覆盖同层风险,V1–V3 新增断言是其直接测试落地点。

### K5 — publicStore 是与 internalStore 平行的第二条增长通道(CRR P2 起才真正激活)

C5 persist hook(opt-in,persist:true 默认 false,MVP 下 publicStore 今天仍零写入点 → "每句新 state"隔离性保持)= **internalStore 有界 ≠ 整个执行上下文有界**。若方向 B/F 落地持久化 session,publicStore 累积的 `<expId>.<key>` entry 不会随 say()结束自动清空(挂在 state 上,say 返回后 GC,但若外部引用持有 —— 应用化会需要)→ total footprint = Σ(internalStore peak≤U_max)+ publicStore accumulation。**N5 多轮会话/EC doc 需显式声明这条独立的增长边界**,不与 C1(U_max/internalStore-only)混淆。MVP CRR P0–P4 范围内,K5 仅作预警注记,不新增验收标准(design §七 R-4🟢低已覆盖反模式:不要把每个中间结果都 persist——那是 internalStore 该干的事;persist 仅用于跨经验/跨轮次的最终返回值类产物)。

---

## 明确不做的事(防止范围蔓延,N1–N6)

| # | 项 | 归属 / 理由 |
|---|-----|-----------|
| N1 | op 内部 lambda/closure/map-filter-reduce 展开(evaluate_expr UNSUPPORTED 注释保留原样,P5+) | evaluate_expr.ts 现有 v8 ignore 块不动 |
| N2 | register file 按类型分区(int32 vs ptr vs struct) | Value 统一 JSON value 语义,MVP 足够;等方向 A 真 LLM 引入更强 schema 再议 |
| N3 | per-step scratch bank($local_<step_id>.* R5.4 可选特性) | P_max=3 + in/out slot 轮转对现有 9 条经验够用;出现需要同时持有 >P_max 中间值的新 op 时再启用,不阻塞主线 |
| N4 | const table spill(R6b:公共常量去重表 $const_0..K≤32) | P4 备选方案,R6a(literal/judge-cond pool size=8/10 round-robin)优先保证 C1 有界即可解锁 P1–P3;R6b 是长期优化非阻塞项 |
| N5 | 多轮会话/EC(doc 08 Environment Context)完整实现 | 方向 B,C5 只提供持久化机制不实现会话层(跨 turn state 生命周期 / env 分层访问另立 doc) |
| N6 | 扩展 global functional registers 枚举超过 {$err,$path}+≤6 预留位 | 新增走本文档变更流程(P4 U_max 固化后冻结);避免 FLAGS-like 寄存器膨胀破坏 CPU 类比清晰度 |

---

## 与既有路线图的关系

- **取代** doc 13 D-C6-1 / D2("嵌套 params 支持 register 引用",原标注缓行):升级为 C2 正式契约(含结构化 ref schema + 编译期类型校验),不再是"Phase C 后续版本可扩展"。
- **并入 T4**:outputs_bindings.schema = "元数据进入执行流"的第一真实消费方,P2 落地后 [pipeline.ts](../../src/l4/pipeline.ts#L33-L42) PRIMARY_OUTPUT Record<string,string> 硬编码表可删。
- **对齐 A(T1/Layer4 planner)**:C2/C5 让经验产物成为可检索、可复用的结构化资产 —— experience-library outputs ParamSpec(Layer4 编排时的能力接口字段,T1 §1.3 已规划)首次真正参与运行时数据流,而非仅文档声明。
- **缓行不变**:D-E2-1 response 模板插值规则不动;$r_path→$path 纯改名;evaluate_expr env map(D-5 修复)由 compiler 显式填充(condition_expr var.name → resolveSlotFor businessName/slot 反查),存量 9 条经验的 condition_expr 手写业务名走 P1–P4 review warning 窗口逐步清零(P4 前全部消除)。

---

## 阶段切分概览(详细设计见 [doc 19b](./19b-register-design.md))

```
P0   需求基线确认 ← (本文档 v1.0 通过评审,U_max/M_max/P_max 初判值锁定或调整)
     └─ checklist 关键项:①U_max=76 临时上界是否接受? ②M_max/P_max=4/3 对现有 9 条经验 formalSpec 逐条核对够用?
       (初步判断 file_write{path,content}✓ / evaluate_expr{expr,env}✓ / glob_match{pattern,path,cwd}=in0,in1,in2✓
        shell_exec{command,args}=in0,in1 ✓ —— 无第 5 输入参数的 op,初判全够,但需过一遍确认)
P1   R5.2/R5.3 scope prefixing + formalSpec.slotIndex(C3 主体)+ literal/judge pool(R6a,C1 有界)
     + C4 $err/$path 改名(D-3 RegisterAllocator→FrameScopeAllocator 复活,D-5 env map 显式填充)
     └─ 验收:C1 internalStore.size()≤U_MAX_P1(暂估 76,P1 末实测替换);tier-a/b/c/d/e e2e legacy mode(useFixedSlotConvention=false)对照全绿后翻转 true;demo-06 nested run-through diff review(预期仅 Address.name 字符串变化、执行轨迹语义不变)
P2   R2 outputs materialization(post-bindings Step5 move generation,C5 persist hook opt-in)
     └─ 验收:pipeline.collect 去 PRIMARY_OUTPUT 硬编码表(resolveResponse 改读 exp.outputs_bindings.type 做插值校验,T4 首落地);safe_write/read_file_with_default publicStore['<expId>.<key>'] 条目出现(C5 首个真实落地点);未声明 bindings 的经验不污染 publicStore(opt-in 回归保护);resolveResponse P2 起从 $path+bindings 反查模板,不再依赖 Record<string,string>
P3   register 引用 in nested params(C2 本体)+ 编译期类型校验(T4 联动 ParamSpec.type check)
     └─ 验收:demo-06 A.file_read.output.content → B.string_replace.input.text 真实传值;$err 传播路径回归(bubbleError 仍读 global $err,与 C2 正交 ✓);负例:ParamRefError 悬空 outKey / type mismatch;C1 size ceiling test 不因新增嵌套深度而突破(P_max slot round-robin per-scope,峰值 max_concurrent_scopes=8×(M_max+P_max)=56 + global/pool 常量 ≈76 不变或微降)
P4   (可选收尾)R6b const table / U_max 实测固化到 doc N4 / legacy mode 删除 & deprecated alias 清理(errors.ts ERROR_REGISTER='$r_err' import 源切换为 GLOBAL_ERR,response.ts/bubbleError/main-loop 同步改 import;全库 rg '\$r_input_|\$argtmp_\|PRIMARY_OUTPUT'清零确认无残留旧名引用)
```

> **回滚开关**:compiler.ts 入口 `useFixedSlotConvention:boolean`(默认 false=P1 前旧行为),逐 Phase 翻转,P1–P3 每阶段跑一遍 legacy mode 对照测试后再永久删除旧路径。详见 design §七风险清单 R-2(feature flag 策略)+ §八文档同步 checklist。

---

## 测试场景清单(CRR P1–P4 落地时 e2e/tier-c/d/e 用例枚举,按 Phase 分组)

### Tier-A(Bounded Register File / C1 size ceiling,新增专用 test file `tests/phase-a/tier-aC1-size-ceiling.test.ts`,各 tier-b/c/d/e 现有 e2e 追加断言)

| # | 场景(验收标准:internalStore.size() ≤ U_MAX) |
|---|------|
| T-A1 | **单步无嵌套**:l1MainLoop({type:'noop'})跑完,internalStore.size()≈0(noop frame pending→done+pop后不残留 slot;或仅含 $err/$path global,C1 K4 例外项计数正确)——**基线零值校验**,防 allocator/scope pop 泄漏导致的非零残余(R-1🔴高回归保护) |
| T-A2 | **长链式调用深度压测**(K3 ×maxConcurrentScopes):构造 A→B₁→B₂→…→B₈(8层串行嵌套,mock L3 service 每层返回一个简单 execute_op child),depth=9 → RecursionDepthError(A11 maxActiveScopes≤8 软限触发);depth=8 → 正常完成且 peak internalStore.size() ≈ design §三核算公式(Σ_{d∈[0..7]} (M_max+P_max slots + judge/cond scratch per active scope) + pool/global constants),断言 `toBeLessThanOrEqual(U_MAX_P1)` 实际常量取 P1/P2/P3 各自实测固化值(design N4/R6b,本文档 C1"~76"为估算,P0 checklist④确认是否接受临时上界还是要求逐 phase 精确化) |
| T-A3 | **literal sidecar round-robin(K4a G1)**:`replace_in_file`(file_read.content→string_replace.text/find/replace→file_write.content,content 被 ≥3 step 复用)+ replace_all=true(literal kind input,走 argtmp pool size=8 round-robin)全链路跑完,internalStore.size()峰值不因 chain length / literal 参数量线性增长 —— **对比现状基线**(同一测试在 legacy mode useFixedSlotConvention=false 下 run一次,记录旧峰值 $r_argtmp_N 单调自增值作为回归对照证据,P1 diff review 用) |

### Tier-B(Cross-request isolation,K1;C5 persist opt-in)

| # | 场景 |
|---|------|
| T-B1 | **两 say()并发隔离**:pipeline.say('read A.txt') 与 pipeline.say('write B.txt', content='x')两次调用(可顺序执行模拟,不必真并发 assert,因 MVP K2 串行主循环不共享调度器),各自 internalStore/publicStore 无交叉引用 —— `expect(state_A.internalStore.keys).not.toOverlap(state_B.internalStore.keys)`(不同 Map 实例天然成立,本 test 主要防未来 P4+/方向B(F EC/R6b const table)引入模块级单例 allocator/scope counter 后破坏此假设,K1 失效条件触发时立即失败) |
| T-B2 | **persist:false(opt-in 默认,G3/V3反向断言)**:replace_in_file/safe_write/find_files/search_in_files/run_shell(未声明 outputs_bindings.materialize/persist:true)跑完 → `expect(Object.keys(state.publicStore)).toEqual([])` —— **反模式防护**(R-4🟢低 + K5 growth channel):开发者若误把 chain-intermediate / step-chain 复用值标 persist:true(V3 G1/G2 tier-d 扩展用例需手动加这条负向断言,防止"长链路/多子引用"场景被错误地用 C5 持久化解决,见 [K4a](#k4--跨较长指令序列--多个子经验复用同一-parent-output-slot的边界条件实现目标--验证目标)) |

### Tier-C(C2 register ref in nested params / deferred binding,P3 核心验收)

| # | 场景 |
|---|------|
| T-C1 | **A→B₁ 单一引用**([demo-06-nested-experience.ts](../../demos/demo-06-nested-experience.ts)现有骨架基础上补真实 param flow):A.file_read.output.content($S_A.out<slotIndex>) → B.string_replace.input.text(kind:'register',{exp:'*',outKey:'content'}),B dispatch in、bindInputs Step0 生成 makeMove(from=$S_A.outK,to=$S_B.in<slotIndexOf('text')>);string_replace OpEntry.inputs.text 解析到的值 === fileReadOp.execute().content(同一 fixture fs.readFile 结果),非空且类型 string(type check:outputs_bindings.materialize.type='string' 匹配 string_replace.formalSpec.inputs.text.type ✓,不触发 ParamRefError) |
| T-C2 | **ParamRefError 悬空 outKey(B 引用的 key 在 A.outputs_bindings 中不存在)**:B.input.find 引用 {exp:'*',outKey:'nonexistent_key'},compileExperience(A)期间 resolveParentOutput 反查失败 → throw `ParamRefError`(`A.<key> not found in outputs_bindings`),tier-c e2e 断言 reject 消息含 'not found'(编译期拦截,不是运行期 null 下传 —— C2/C3/T4 schema-driven contract 的核心语义验证点,demo/测试若只验"能跑通"而不验"错引用会抛",C2 契约等于没落地) |
| T-C3 | **ParamRefError type mismatch**:B.input.numeric_field(kind:'number')← A.outputs_bindings.content.materialize.type='string',type check 阶段 compile-time 拒绝(design §四 R5.4 "resolveSlotFor businessName/slot 反查 + type match 检查,T4 首真实消费方之一")→ throw `ParamRefError`(message 含 `incompatible type`)—— **防 P0 checklist 里 FormalParam.register:string→slotIndex:number 迁移后,type 字段被意外丢弃**(schema 变更最大返工点风险项) |

### Tier-D(K4a G1–G3/V1–V3 多子复用父 output slot / setup_workspace 扩展)

| # | 场景(在 [tests/phase-d/tier-d-scenarios.test.ts](../../tests/phase-d/tier-d-scenarios.test.ts#L195-L243)现有 setup_workspace(safe_write/write_file×2/replace_in_file/read_file,纯 literal/input 引用、**尚无 register kind**)基础上扩展) |
|---|------|
| T-D1 | **同 experience chain-intermediate 复用(G1/V1)**:`replace_in_file`扩为五步(file_read→string_replace→grep_check(reuse content)→file_write(content=替换结果非原content)→read_verify),file_read.content($S_A.outK)被 string_replace.text/grep_check.path?/file_write...等 ≥3 step 引用 —— 每步 resolveInputs(`state.internalStore.get('$S_A.out<slot>')`)读到同一值;internalStore.size()peak ≤ U_MAX_P3(design §三 ×8 maxConcurrentScopes 已包含此链式消费深度,不因 chain length 额外线性增长);**新增断言**:该 test run完 publicStore.size()===0(K4a V3反向防护,T-B2同款断言复用到 tier-d,防开发者误把chain-intermediate标persist) |
| T-D2 | **多子引用串行 CALL(G2/V2,callee-saved convention直接验证)**:setup_workspace扩展版,A.file_read.output.content分别被 B₁(如 replace_and_log.step_string_replace)+B₂(read_verify,假想的第二条后续步骤)先后 bindInputs copy,**两次 makeMove(from=$S_A.outK,to分别为$S_B1.inK/$S_B2.inK,物理地址不同 scope prefix隔离)执行顺序严格串行(K2 MVP无Promise.all fan-out)**,断言:`expect(internalStore.get('$S_B1.in<slotText>')).toEqual(expectedContent)`且`expect(internalStore.get('$S_B2.in<slotText>')).toEqual(sameExpectedContent)`——**同址源、异址目标、值一致**,caller-saved convention正确性直接验证;若未来引入并发fan-out(Promise all跑B₁/B₂同时dispatch,K2失效条件触发),本用例需拆分为"串行版保留+并行版另立新test标记@flaky-pending-K7",不要静默改现有assertion口径(design §五 R-1/R-3已覆盖同层风险,T-D2是其直接测试落地点,V2新增断言补齐V1未覆盖的"跨scope多次copy一致性") |
| T-D3 | **A.frame retention window边界**:T-D2中额外断言,B₁ dispatch in→done+pop期间,$S_A.outK未被B₁覆写(B₁.formalSpec.outputs不alias $S_A的任何out slot —— 这是K4 caller-saved convention的物理前提,**编译期即可检查**:resolveParentOutput/makeNestedIntent生成OpEntry时,断言callee的outputs地址集合 ∩ callee引用的parent out-slot集合 ===∅(或至少≠from-src所在address),tier-d e2e加一条纯静态/compile-time assertion helper `expectNoScopeAliasing(aFrame,bFrame)`而非等到运行时才发现) |

### Tier-E(Evaluate_expr env map 显式填充 / D-5 修复,P1)

| # | 场景 |
|---|------|
| T-E1 | condition_expr里`{type:'var',name:'$r_err'}`→ resolveSlotFor命中global $err(env map={'$r_err':'$err'}显式填充,demo-04-error-handling/demo-05-l3-compiler现有case回归验证,D-5 fallback warning清零后不再走`?? name`路径) |
| T-E2 | **存量9条经验condition_expr手写业务名review窗口**(P1–P4):safe_write.judgment.condition_expr(is_null($r_err))等全部迁移为scope-aware/formalSpec.businessName引用,console.warn计数从N(P1初值)逐 phase递减到0(design §五 R-5🟡中);**负例**:故意保留一条旧写法跑一次,断言trace日志含 'legacy var.name fallback'警告且结果仍正确(fallback兼容期证明),再删除该test case确认warning消除 |

---

## 评审 Checklist（P0 通过前逐项打勾）

- [ ] C1–C5 能力定义与需求方(用户/上游 L4/Layer4 planner/T4 消费方)对齐 —— 特别是 C2「按业务名字引用」的语义粒度(outKey vs register name,选前者 = T4 schema 驱动,不暴露 slot index 给用户作者)
- [ ] M_max/P_max=4/3 对现有 9 条经验的 formalSpec 逐 op 核对:**🔴 P0/T-0.1 实证 dump(2026-08-22)打破 M_max=4 假设**——`string_replace` 有 5 个 input slots(text/find/replace/regex/replace_all),需将 **M_max 上调为 5**;P_max=3 经验证有效(所有 op 非 error outputs ≤3)。file_read{path,encoding}=2 ✓ / file_write{path,content,mode,encoding}=4 ✓ / shell_exec{command,args,cwd,timeout_ms}=4 ✓ / glob_match{pattern,cwd}=2 ✓ / grep_search{pattern,path,regex,context_lines}=4 ✓ / **string_replace{text,find,replace,regex,replace_all}=5 ⚠️** / evaluate_expr{expr,env}=2 ✓ / increment_counter/decrement_counter{value}=1 ✓ / sort_by{items,by,desc}=3 ✓ / take_first{items,n}=2 ✓。**修订决策**:M_max=5 / P_max=3,同步重算 U_max ≈ 2(global)+ 8(literal pool)+ 10(judge/cond pool)+ 8×(M_max 5 + P_max 3)= **≈ 84**(设计文档 §三需同步修订)。✔️ P_max=3 / error alias 复用 global $err 一致(11 条 op 全部有 $r_err output):shell_exec 的 stdout/stderr/exit_code/error 4 项 = 3 output slots + global $err ✓。
- [ ] C5 persist 默认 false(opt-in):MVP 下「每句新 state」隔离性保留(pipeline.say() 每次 createInitialState,publicStore fresh at start = 今天行为);多轮会话持久化是 P4+ 方向 B/F 的前置依赖而非本期目标
- [ ] U_max 初判值(§三核算 ≈76)接受为临时上界 vs 要求 P1 就给精确实测值 → 本文档暂取前者(P4 固化),评审方确认或调整
- [ ] N1–N6 边界无遗漏:特别是 N3(per-step scratch bank)若被判定"P_max=3 不够"(如某 op.formalSpec.outputs>3+error?当前 max outputs=file_read{content,error}✓ / grep_search{matches,count}?⚠️ matches 是 list<struct>,count 可推导但正式声明了两枚 output → $out0,$out1 ✓;shell_exec{stdout,stderr,exit_code}=**3 个 output + error?** —— ⚠️ **核对**:shellExecOp.formalSpec.outputs={stdout:$r2?,stderr:$r3?,exit_code:$r_err??},需检查 errors.ts 里 exit_code 是否复用 GLOBAL_ERR slot(若是则 shell_exec output slots=2 ≤P_max ✓;否则=P_max+1,P_max 应上调至 4 或 shell_exec.error→$err/stderr 合并?)—— **此为本设计最需逐条 formalSpec dump 后定稿的开放项**,建议 P0 review 前作者跑一遍 `for op of L2Registry.list(): console.log(op.name,Object.keys(op.formalSpec.inputs).length,'/',Object.keys(op.formalSpec.outputs).length)` 输出表附入 design §三核算旁证
