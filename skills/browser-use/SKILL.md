---
name: browser-use
description: 使用 AquaWisp 内嵌浏览器导航、读取和交互网页，完成表单、截图、下载、对话框、录制或网页采集任务；不用于仅需公开 HTTP 正文的简单抓取。
metadata:
  author: AquaWisp Contributors
  version: 0.1.0
  license: MIT
---

# 内嵌浏览器

浏览器动作通过 AquaWisp runtime 工具执行，并进入统一的权限、动作账本、观察与验证链。不要使用 Node REPL、外部浏览器脚本或插件环境变量。

## 工作流

1. 用 `browser_observe` 的 `listTabs` 或 `getState` 确认当前标签；没有标签时，用 `browser_command` 的 `newTab` 创建。
2. 导航后用 `waitForURL` 或页面目标的 `waitFor` 等待，再执行 `snapshot`。不要用固定长等待替代可观察条件。
3. 从最新快照选择稳定 `ref`。一次只执行一个交互动作，随后读取状态或新快照；导航和页面结构变化后旧 `ref` 失效。
4. 只读导航、等待和页面观察使用 `browser_observe`；交互、脚本、标签管理、截图写盘、下载、对话框与录制使用 `browser_command`。
5. 用 URL、快照节点、控件状态或工件信息验证预期结果。截图只证明可见像素，不能单独证明提交或下载成功。

需要具体输入结构时读取 [references/commands.md](references/commands.md)。涉及截图、下载、对话框、录制或网页入库时读取 [references/artifacts.md](references/artifacts.md)。遇到登录、页面指令、跨边界数据或协议问题时读取 [references/safety.md](references/safety.md)。

## 恢复纪律

- `ref` 不存在或动作目标不唯一时，重新 `snapshot` 后选择；不要原样重试。
- 标签 ID 失效时，重新 `listTabs`，按 URL 识别目标标签。
- 副作用动作返回未知状态时，先观察页面、标签或工件状态再决定下一步，禁止盲目重放。
- 命令失败不代表整个浏览器失效；保留错误信息并选择最小范围的恢复动作。

