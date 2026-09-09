# Phase E — L4 + 端到端(Mock LLM + Pipeline)

> 48 个测试 / 3 个文件 / 全部通过
> 策略:Mock L4 规则表替代真 LLM,验证自然语言→intent→执行→人类可读回复的完整链路

[← 返回主索引](../README.md)

---

## Phase 目标

验证 L4 层(Mock LLM 规则表)识别自然语言意图,通过 Pipeline 端到端调度 L3 经验,
最终生成人类可读回复的完整链路。这是 MVP 的收官层,验证"自然语言是唯一入口,
上层接触不到指令栈"的边界。

## 测试策略

- Mock L4:用规则表(INTENT_RULES)模拟 LLM 识别,9 条规则覆盖全部核心经验
- Pipeline 端到端:自然语言→MockL4.recognize→ExperienceService→l1MainLoop→真实文件系统
- resolveResponse:验证 $r_err/$r_path→消息模板的映射逻辑
- pipeline.collect:验证 outputs_bindings→publicStore→primary output 的提取

---

## 文件索引

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [e1-mock-llm](./tier-e1-mock-llm.test.ts) | 18 | MockL4 识别:9 条规则覆盖全部核心经验(每条至少可被一句话命中)、具体模式优先(read_file 优先于 read_file_with_default)、Pipeline 端到端(自然语言→真实世界:读文件/写文件/安全写入/检查存在/搜索/替换/shell) |
| [e2-response](./tier-e2-response.test.ts) | 14 | resolveResponse(L3 消息解析):优先级 1($r_err 非空→failure[code] 模板)、failure['*'] 兜底、优先级 2($r_path 标记→对应 path.response 分支消息)、默认失败格式、每句话都有人类可读回复 |
| [eC5-pipeline-public-store](./tier-eC5-pipeline-public-store.test.ts) | 16 | pipeline.collect + PRIMARY_OUTPUT(CRR T-2.4):全部 9 条 CORE 经验 primary 提取正确、PRIMARY_OUTPUT 硬编码表已删除、legacy fallback(P2→P4 过渡兼容)、未声明 outputs_bindings→primary=null、persist:true binding→primary 取首个 |

---

## 关键覆盖点

- Mock L4 规则表:9 条核心经验全部可被自然语言命中
- Pipeline 端到端:自然语言→识别→编译→执行→真实文件系统
- resolveResponse 消息映射:$r_err→failure 模板、$r_path→分支消息
- pipeline.collect:outputs_bindings→publicStore→primary output 提取
- CRR PRIMARY_OUTPUT 硬编码移除,改由 outputs_bindings 驱动

## 已知未覆盖

- 真 LLM 接入:MockL4.recognize 替换为真模型调用(接口已就绪,未实现)
- 经验库扩充至 30-50 条(当前 9 条核心)
