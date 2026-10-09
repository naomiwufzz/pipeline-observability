---
name: pipeline-observability
description: 全链路可观测性数据追溯看板。触发词：埋点看板、埋点监控、看研发流程数据、门禁通过率趋势、任务成功率、工具成功率、Replan 率、用户纠正率、优化前后对比、各阶段耗时/token/成本分析。把 Claude Code 研发会话（transcript + ⟦TRACK⟧ 哨兵）编译成 RDC→工作流→阶段三层下钻看板，并派生 Agent 全链路指标。
---

# 全链路可观测性数据追溯

把 Claude Code 研发流水线的 transcript + 哨兵标记编译成三层下钻看板（RDC 列表 → 工作流报告卡 → 阶段卡），并从 transcript 派生 Agent 可观测性指标，让流程优化有据可依。

## 指标口径

看板从每次会话的 transcript + 哨兵派生下列指标，全部本地计算、零外部依赖：

| 指标 | 口径 | 数据来源 |
|---|---|---|
| 任务成功率 | wf-end 结果（缺失时按末阶段门禁推断） | `⟦TRACK wf-end⟧` 哨兵 / 门禁推断 |
| 门禁通过率 | PASS 门禁数 / 有门禁结论的阶段数 | `⟦TRACK gate⟧` 哨兵（硬数据） |
| 工具成功率 | tool_result 无 error 且非空 / 全部 tool_result | transcript `is_error`（硬数据） |
| Replan 率 | 回退重进阶段数(nth>1) / 阶段总数 | `⟦TRACK phase nth⟧`（硬数据） |
| 平均循环次数 | 每阶段助手轮数均值 | transcript 助手消息数（硬数据） |
| 用户纠正率 | 发生纠正的阶段数 / 阶段总数 | user 文本启发式命中（软信号） |
| Token / 成本 | 按各阶段首选模型价格表估算 | transcript usage × config.prices |
| Sub-Agent / KB 命中 | Task 调用数 / KB 工具命中数 | transcript tool_use（硬数据） |

**Trace 串联**：Intent(wf title)→Plan(计划拆解阶段)→Action(tool)→Observation(tool_result)→检索证据(KB)→Replan(nth>1) 已隐含在阶段序列里，看板按工作流报告卡的时间顺序展开，无需独立 trace 系统。

## 环境（所有命令前置）

```bash
# Set these for your environment before running the commands below.
export PIPELINE_OBSERVABILITY_SOURCE="$HOME/.claude/projects"
export PIPELINE_OBSERVABILITY_OUT="$PWD/workspace-cache/pipeline-observability"
export PIPELINE_OBSERVABILITY_CONFIG="$PWD/config.json"
```

禁用 `/d/node.exe`（坏的 v18.17.0）。

## /埋点看板

采集 + 渲染 + 告知用户打开看板：

```bash
node collect.mjs              # 扫 transcript，增量更新账本
node render.mjs               # 账本 → dashboard.html
```

完成后打开：`$PIPELINE_OBSERVABILITY_OUT/dashboard.html`

## /埋点 track

读 `references/sentinel-convention.md` 全文并注入当前会话上下文，之后本会话按约定打 `⟦TRACK⟧` 哨兵行。用于模式 B（按需引入）或临时启用埋点。

## /埋点 mode <always|on-demand>

改本地 `config.json` 的 `mode` 字段：
- `always`：保留 SessionEnd hook（自动采集）+ CLAUDE.md 里的哨兵约定引用（常驻注入）。
- `on-demand`：移除上述两者（改 `~/.claude/settings.json` / 项目级 `CLAUDE.md` 前先备份）。

## 看板信息架构（从上到下）

1. **KPI 总览**：总成本 / 总 Token / 工作流数 / RDC 数 / 门禁通过率 / 工具成功率 / 任务成功率。**只统计哨兵确认的工作流**，数字干净可信。
2. **优化前后对比条**：见下节。
3. **哨兵确认区**：主动打了 ⟦TRACK⟧ 的工作流，置顶。默认全部折叠，点击展开看阶段明细。
4. **推断历史折叠区**：未打哨兵、按首条消息自动归因的历史会话，整块折叠收起（标题标数量+量级），仅供回溯参考。

所有 RDC / 工作流默认折叠，避免长报告淹没重点。

## 优化前后对比

「优化前后对比」条：按本地 `config.json` 的 `compareWindowDays`（默认 7 天）把工作流切成近 N 天 / 之前两组，对比门禁通过率、工具成功率、用户纠正率、Replan 率、平均循环，用 ▲▼ 标注改善/退化。想看某次优化的效果，在优化落地日之后跑看板即可。

## 价格表配置

成本口径：**实际金额 = 原价 × discount**，单位人民币 ¥/百万 token。成本按各阶段 `models[0]`（首选模型）估算，跨模型阶段为近似值；`<synthetic>` 等合成模型记 0。

价格表在 render 时浅合并。复制 `config.example.json` 为本地 `config.json` 后,
把部署方自己的模型和价格写入 `prices`；真实价格不应提交到公开仓库。

**折扣语义**：中文「X 折」= 付原价的 X/10。如「0.52 折」→ `discount: 0.052`（5.2%），「8.04 折」→ `discount: 0.804`。

**四档单价怎么来**：平台通常只给总额+四档 token，不给四档单价。按官方比例 `input:output:cacheCreate:cacheRead = 1:5:1.25:0.1` 反解：`P = 原价×1e6 / (in + 5×out + 1.25×cacheCreate + 0.1×cacheRead)`，再按比例展开四档。反解后用平台原价自检（重算应回到平台值，误差 <1%）。

## rdc 归因

- 优先用 `⟦TRACK wf⟧` 哨兵的 rdc（**哨兵确认**）。
- 会话整段没打 wf 哨兵时，从**首条真人消息**提炼意图作 fallback rdc（**推断**，看板标「推断」灰标）。清洗规则：跳过 skill/系统前缀行（`Base directory for this skill:` 等）、图片占位；`@proj/path` 保留项目名；丢弃纯代码符号。
- 清洗后仍无意义的才归 `__unattributed__`（rdc=null，不进树）。
- 副作用：历史会话首句各异，会产生较多独立 RDC（碎片化但据实）。想合并请对相关历史会话补打统一 rdc 的 wf 哨兵后重扫。

## 数据说明

- **状态（status）** done/blocked 是结构推断，非硬记录。
- **门禁 —** / **任务结果 未知(推断)** 表示未打对应哨兵，不代表失败。
- **owner/doc/days** 未打哨兵则整行隐藏，不编造。
- 账本 `phases.ndjson` / 产物 `dashboard.html` 落在 `workspace-cache/pipeline-observability/`。
- **改了指标口径/价格表想让历史数据也生效**：删 `workspace-cache/pipeline-observability/offsets.json` 后重跑 collect（全量重扫），否则增量采集只更新变化的会话。价格表改动只需重跑 render（成本在渲染时算）。
