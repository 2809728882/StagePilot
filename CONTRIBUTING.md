# Contributing to StagePilot

1. Fork 仓库并从 `main` 创建功能分支。
2. 运行 `npm install` 安装依赖。
3. 完成修改后运行 `npm run check` 和 `npm test`。
4. 提交 Pull Request，说明修改动机、行为变化和验证方法。

代码变更应保持窗口状态可回滚，不在日志或测试夹具中提交密码、令牌、本机绝对路径或个人文件。新增控制指令时同时验证认证、输入校验和错误恢复；UI 修改应兼顾手机竖屏、横屏和安全区。
