# 间筑：Windows Server / 阿里云 ECS

目标实例：`i-bp1dhypbynl6vvvracv9`，公网 IPv4：`101.37.71.218`。

这是 Node.js / Next.js 部署，API 使用 DeepSeek 与配置好的豆包兼容接口。
无需 Cloudflare 登录。浏览器中的 2D / Three.js 3D 和本地模型资源保留。

预算接口从发布包中的 `data/prices` 读取月度价格书；发布包不包含
`data/price-sources` 的原始留档。需要更新官方价格时，在开发机运行
`node scripts/import-price-book.mjs --input <官方 Excel/CSV> --city <城市> --period <YYYY-MM> --source <来源> --source-url <链接>`，
通过校验后重新打包部署。导入脚本和已校验的 JSON 会随发布包提供，接口缺少城市数据时会回退并标注离线参考价。

## 让 Codex 直接部署（推荐）

当前服务器只开放了远程桌面。若希望我直接上传并部署，请先在服务器的管理员 PowerShell
执行下面的命令（这一步必须由你在 RDP 中手动执行）：

```powershell
$key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICgPkZk2sEgsObZXTT8PhdH9w61KLEpLXbcDZMcPblR1 codex-jianzhu-deploy'
Set-Location C:\Deploy\Jianzhu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\Enable-JianzhuSsh.ps1 -PublicKey $key
```

同时在阿里云安全组放行 TCP 22。完成后回复“SSH 已开启”，我会测试 `administrator@101.37.71.218`
的密钥登录，随后自动上传压缩包、执行安装器并检查公网访问。私钥只保存在本机的
`.tmp\deploy\jianzhu-deploy-ed25519`，不要复制到服务器或发到聊天中。

## 首次安装

1. 在开发机运行 `npm run package:ecs`，得到 `.tmp/deploy/jianzhu-windows-source.zip`。
2. 将 ZIP 复制到服务器，完整解压到一个目录，例如 `C:\Deploy\Jianzhu`。
3. 在服务器上以管理员身份打开 PowerShell，执行：

```powershell
Set-Location C:\Deploy\Jianzhu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\Install-Jianzhu.ps1
```

脚本会隐藏输入 API Key，默认使用豆包接口，需要填入账号已开通的视觉模型或接入点 ID。
已有环境文件时可使用 `-EnvFile 'C:\安全目录\.env.local'`，文件需包含
`DEEPSEEK_API_KEY`、`VISION_API_KEY`、`VISION_BASE_URL` 和 `VISION_MODEL`。
ZIP 不含任何密码或 API Key，请通过远程桌面磁盘映射单独复制环境文件。

安装器在 `C:\Apps\Jianzhu` 下创建独立 Node 运行时（若有 Node 22+ 则复用）、
版本目录、私有配置与日志。构建通过后注册 `Jianzhu-Web` 计划任务，开机自动启动，
异常退出后一分钟重启。运行账号为 SYSTEM，目录仅管理员和 SYSTEM 可访问。

首次安装需要服务器可以访问 Node.js 下载站与 npm 仓库。当前字体使用 Next/font Google，
构建时还需要访问 Google 字体服务；若该网络不通，构建会明确失败并停止，不会宣称部署成功。
构建完成后的字体及 3D 模型资源均由本站提供。依赖镜像可通过 `-NpmRegistry` 参数指定。

端口 80 已占用时脚本会停止，既有网站不被覆盖。可显式传入 `-Port 3000`。
存在同名计划任务时也停止，避免误替换现有部署。

## 网络和验收

安装器仅添加所选端口的 Windows 入站防火墙规则。阿里云安全组须另行放行同一 TCP
端口（默认 80）。首次可访问 `http://101.37.71.218/`；配置备案域名后再接入 HTTPS。

安装器会检查首页 200 和 `GET /api/floorplan/recognize` 配置就绪。
这不代表模型识别质量已通过，最终还应上传真实户型图并验证生成、2D/3D 与导出。

## 维护

```powershell
Get-ScheduledTaskInfo -TaskName Jianzhu-Web
Stop-ScheduledTask -TaskName Jianzhu-Web; Start-ScheduledTask -TaskName Jianzhu-Web
Get-Content C:\Apps\Jianzhu\logs\stderr.log -Tail 60
```

环境文件：`C:\Apps\Jianzhu\shared\.env.local`。修改后重启计划任务。
更新版本时先保留旧版本和任务配置，使用新目录构建验证后再切换任务；本安装器不执行更新或删除。
