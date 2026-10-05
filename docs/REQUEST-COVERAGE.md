# AliasChat 请求覆盖核查与 Mac 抓包（2026-10-05）

本次没有真实登录账号的请求抓包。以下区分代码行为、测试构造和待确认的站点协议，暂不扩大请求路径或字段白名单。

## 已找到的证据

- `extension/rewrite.js` 的路径规则为 `/\/(completion|conversation|chat_conversations)(\/[a-z_]+)?(\?|$)/`；页面 fetch 和 XHR 共用该规则。`extension/bridge.js` 和 rewrite.js 都只改写 `prompt`、`parts`、`extracted_content`、`text`、`content` 字段。`title` 和 `message_content` 不在字段白名单里。
- 当前源码和测试没有 `retry_completion` 或 `message_content`。历史提交 `2d2156a` 的根 HANDOFF.md 曾写“待达叔：⑤ retry_completion 需真账号抓包验证”；`b08f741` 更新交接状态时删掉了这条待办。两次提交中它都只是文档文字，没有路径实现或抓包固件。可用 `git log --all -S retry_completion` 和 `git show <commit>` 复核。
- 当前 `title` 的代码命中是 `demo/fake-api.js` 的 CLI 假 API：根据提示里的 “write the title” 返回固定标题。这不是浏览器标题请求的证据。
- `test.js` 构造 completion/conversation JSON 和 form 请求；`demo/verify-web.js` 在页面中主动调用固定 completion/conversation 地址。后者不是通过站点 UI 触发编辑、重试或重新生成，也不能证明这些操作已覆盖。
- 本次直接调用 isChatRequest 的合成探针：`/api/organizations/o1/chat_conversations/c1/retry_completion` 返回 false；`/backend-api/conversation/c1/title` 返回 false；`/backend-api/conversation/title` 返回 true。这些只是规则探针，不是抓到的网络路径。笼统地说 “title 路径都不匹配” 不准确。
- 本次直接调用 rewrite 的合成 JSON：`message_content: "probe@example.com"` 原样保留，`prompt` 被遮蔽，`model: "probe@example.com"` 原样保留。这确认字段白名单行为，不能证明 message_content 是站点发送用户正文的字段。

第二轮审查的原始测试固件不在仓库中。请补该测试的实际 URL、方法和完整请求体结构，才能将 message_content 定位到具体操作。未知字段可能是协议数据，不能据名称改写所有字符串。

## Mac Chrome 操作步骤

1. 在 chrome://extensions 加载本次版本，随后刷新 chatgpt.com 和 claude.ai。分别记录 Chrome 版本、扩展版本、网站、日期、是否登录、模型和操作名称。
2. 用虚构数据分别测试两个网站：`Email probe.person@example.org; DOB: 1988-03-12. Reply briefly.` 每组操作使用新的聊天，避免旧历史干扰。
3. 操作前打开 DevTools → Network，启用 Preserve log，清空日志。保留全部请求，检查 Fetch/XHR，也留意其他传输类型；不要只按 completion/conversation 过滤，否则会漏掉本次待核查的路径。
4. 分开记录：首次发送；编辑已发送消息并保存/发送；对回复重新生成/重试；新聊天自动生成标题；手工重命名标题。如果失败重试仅在错误状态下出现，记录触发方式和界面按钮文字，并在出现该按钮时另抓一组。找不到按钮则注明未覆盖。
5. 每次操作后保存相关请求的完整 URL（含查询参数）、HTTP 方法、Initiator、Content-Type、Content-Encoding、Payload 原文、响应状态和操作时间。JSON 保留嵌套字段和数组结构；form 保留字段名与解码后的值；gzip 请求提供原始字节或解压后的完整正文，并注明编码。只有截图中的字段名不足以决定规则。
6. 对比同一操作在扩展关闭和开启时的抓包（切换后刷新页面，另建聊天）。关闭时定位虚构原文出现的路径和字段，开启时查看发出的正文是否已变成占位符。DOM 显示真值是预期还原，不能据此判断网络泄漏。
7. 将这些请求导出为 HAR with content，并另附操作对应表和必要的解压正文。共享材料只需上述请求头，不需 Cookie、Authorization 或账号标识；保持虚构邮箱、生日和字段结构，以便形成可提交的回归固件。

收到材料后：将确有用户正文的路径/字段加入针对性规则，同时为编辑、重试、重新生成和标题操作添加从抓包裁剪的固件。覆盖 JSON/form/gzip 中实际出现的格式，断言正文被改写、协议 ID/模型/令牌保持不变、相邻无关路径不受影响，再执行 npm test。

本次未运行 demo/verify-web.js：沙箱 Chromium 启动崩溃已知，真实 UI 操作及上传流程仍需 Mac Chrome 验证。
