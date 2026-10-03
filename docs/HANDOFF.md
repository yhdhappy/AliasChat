# VeilAI — 项目状态（HANDOFF）

> 每次让 Codex / pi 干活前先读此文件，干完更新。额度中断后从这里接着来，不许偏离。

## 项目一句话
VeilAI = mask2ai（MIT）的二次开发 fork：Chrome 浏览器插件，在用户消息发往 ChatGPT / Claude 网页版之前，把个人敏感信息替换成占位符，AI 只看到占位符，回答回来后在屏幕上还原真值。目标：免费+付费高级版，卖到国外，达叔的副业目标 $10/天。

## 关键决策（已定，不许擅改）
- 品牌名：VeilAI（2026-10-04 达叔亲定）
- Logo：第 1 个方案（盾牌+气泡+面纱），达叔待发原图
- 基准项目：serkankorkut/mask2ai v0.6.0，MIT（Copyright 2026 Serkan Korkut，LICENSE 必须原样保留）
- 仓库：github.com/yhdhappy/veilAI（public），47 个提交历史已推送（已滤掉 .github/workflows，因 token 无 workflow 权限）
- 变现：免费核心 + Pro（团队策略包、审计日志、更多站点、文件脱敏），Gumroad 起手 $5 一次性
- 节奏：边做边接单（达叔每天分 2-3 小时 Fiverr 保底）
- 英文：产品文案/客服邮件由 Muse 写，达叔读写可以、口语不行

## 当前进度
- [x] Phase 0 验货：仓库真实、MIT 确认、npm test 通过、机制读懂
- [x] 仓库建立 + 代码推送（2026-10-04 凌晨）
- [x] Logo：第 1 方案（盾牌+气泡+面纱），已切 16/32/48/128 换进 extension/icons/，原图存 brand/veilAI-logo-original.png（2026-10-04 早）
- [x] Phase 1：品牌重命名 mask2ai→VeilAI + 去 Turkish（2026-10-04 上午，Codex gpt-6-luna 执行，pi deepseek-v4.1-flash 审查 FAIL→修完 7 项→PASS）
  - 改名：manifest/README/store listing/options.html/content.js toast/hooks/plugin.json/marketplace.json/demo 脚本；插件统一 kebab-case 身份 `veil-ai`；LICENSE 未动
  - 去 Turkish：删 TCKN 校验+模式、PLATE、土耳其地址/DOB/证件/姓名线索、FOLD 字符映射、土耳其手机号格式；保留 `\b0\d{4} ?\d{6}\b`（实为英国手机号，测试要求）
  - 刻意保留的内部标识（兼容性）：MASK2AI_CONFIG、`~/.mask2ai/config.json`、`.mask2ai.json`、`data-mask2ai`、`mask2ai-config` postMessage、`~/.claude/veilAI`（已改名）、JS 命名空间
  - `npm test` 通过（ok / office ok）
- [ ] Phase 1b：安全修复（Claude 网页版审计报告 10 项问题，达叔已批用 gpt-6.1-sol）
  - 修：①同名二次扫描 ③postMessage token 加固 ④fail-closed+toast ⑥哈希加长+会话盐 ⑦迁 chrome.storage.session ⑧自定义正则保存校验 ⑩XHR 拦截 ②结构化中文格式（手机/身份证/银联卡）
  - 不修：⑨（CLI 插件范围外）②中文姓名/地址（要 NER，Phase 2）
  - 待达叔：⑤ retry_completion 需真账号抓包验证；⑩需真站验证
- [ ] Phase 2：物料（截图、商店描述）
- [ ] Phase 3：Gumroad 上架 + license 验证接入
- [ ] Phase 4：Chrome 商店上架（$5 达叔付）+ Edge（注意：store/listing.md 的 privacy policy URL 目前是 GitHub 仓库地址，上架前需换成真实隐私政策页）
- [ ] Phase 5：Product Hunt / Reddit 获客

## 技术要点（给 Codex 的）
- Manifest V3，vanilla JS，无构建步骤，`npm test` 必须通过
- 拦截机制：content script 跑在 MAIN world，包裹 window.fetch，URL 匹配 `/completion|conversation|chat_conversations`，改写请求体；MutationObserver 扫文本节点还原占位符（不依赖对方 DOM 结构）
- 脆弱点：OpenAI/Anthropic 改 API 路径或请求格式 → 跟修。只做 chatgpt.com + claude.ai 两站
- 已知短板（Pro 卖点）：ChatGPT 文件上传两步流程未处理；浏览器内 PDF/图片不检查；纯模式匹配
- 商店状态：原作者从未提交 Chrome 商店，我们有机会第一个上架

## 额度/上下文管理
- Codex Plus 和 OpenCode Go 均有 5 小时额度限制
- 任务切小块，每块独立可验证；额度用完立刻停，把进度写进此文件再下班
- 达叔说"额度到了"我就记一笔

## 销售渠道清单（达叔要求记好，工具做好后逐步指导上架）
- 分发：Chrome 商店（$5）、Edge（免费）、Firefox（免费）
- 收款：Gumroad → Lemon Squeezy → Paddle
- 获客：Product Hunt、Hacker News Show HN、Reddit
- 后期：AppSumo
