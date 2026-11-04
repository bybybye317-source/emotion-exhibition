# 独立共享讲台服务（腾讯云 Linux 服务器）

状态（2026-11-04）：独立腾讯云实例已通过可信公网 HTTPS、SQLite 健康检查、合成测试图像与表情分数的传输测试，以及实际服务重启后的房间恢复。生产采用 [原生 systemd 方案](native-README.md)，地址为 `https://43.161.198.80`。下面的 Docker Compose 是备选方案，仅校验了配置，未作为本次生产部署方式。课堂手机网络仍需现场验证。

本服务独立运行项目原有房间逻辑，不访问或代理旧 `chatgpt.site` 服务。使用 Node 24 内置 SQLite，无额外 npm 依赖。原生方案将数据库保存在专用系统目录；以下 Compose 方案使用命名卷。Caddy 管理 HTTPS。五小时截止、主持/参与权限、32 条照片上限及六片贡献协议保持一致。

## 部署前要确认

- 优先复用已有服务器；新购服务器预算每月不超过 50 元。域名费用单独确认。
- 已有服务器的系统、余量和现有业务；本服务默认使用 80、443、8787，安装前检查是否被占用。
- 一个实际可管理的域名，以及对应 A 记录。不要填写示例域名。不要购买未确认的域名或配置自动续费。
- Linux 上有 Docker Engine 和 Compose。此 Compose 使用 Linux host network；不作为 Mac Docker Desktop 部署配置。
- 仅 80/TCP 和 443/TCP 供互联网访问；8787 只绑定 localhost。防火墙调整前列明目标和现有规则。
- 中国内地实例对外提供网站服务需符合服务商的备案要求；境外线路仍需教室网络实测。参考 [腾讯云使用限制](https://cloud.tencent.com/document/product/1207/44376) 与 [套餐价格](https://cloud.tencent.com/document/product/1207/73452)。

## 启动

将完整 `room-server/` 放到专用目录，例如 `/opt/empathy-classroom/room-server/`。不要覆盖服务器现有项目。

```sh
cd /opt/empathy-classroom/room-server/deploy
cp room.env.example .env
# 编辑 .env，把 ROOM_DOMAIN 改成真实域名。
docker compose config --quiet
docker compose up -d --build
curl --fail http://127.0.0.1:8787/api/health
curl --fail https://实际域名/api/health
```

Caddy 需要 DNS 正确指向这台服务器且 80/443 可达，才可签发公开可信证书。参考 [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)。已有 Nginx/Caddy 的服务器应集成到现有反代配置，不能直接抢占端口。

`room_data` 保存 SQLite 数据。不要运行 `docker compose down -v`，那会删除数据库。重启服务不会重置已存在房间的五小时截止时间。无需把参与照片导出或复制到新服务；新后端使用新房间。

## 切换网站前验收

1. 验证健康检查确实访问 SQLite，而不是只返回静态 `ok`。
2. 创建一个测试房间，验证服务器写入五小时截止。
3. 独立浏览器加入，验证加入凭证、共享同意、照片提交、大屏同步和主持权限。
4. 用户手机 Safari 使用教室网络扫码，完成一次采集，确认三感官变化。
5. 上述通过后，才将前端 `DEFAULT_ROOM_API` 切到真实 HTTPS 域名并发布；更新邀请版本。
6. 主持人缓存按 API origin 隔离。旧服务的房间凭证不能被发送给新服务；重新生成讲台二维码。

## 运维

```sh
docker compose ps
docker compose logs --tail=50 relay
docker compose restart relay
```

日志不记录照片、邀请链接或凭证。健康检查失败先排查磁盘空间、数据库权限、容器状态和反代，不能靠关闭 HTTPS 或权限验证修复。数据库备份会保留参与照片；不要默认加入长期备份，另行确定保留规则。
