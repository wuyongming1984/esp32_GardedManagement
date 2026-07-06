# 服务器部署步骤

本文记录把苗圃智能管理程序部署到任意一台新的 Linux 服务器上的步骤。示例以 Ubuntu 24.04 / root 用户为准。

## 1. 服务器准备

推荐配置：

- 2 核 4G 内存或更高
- 80G 系统盘
- Ubuntu 24.04 LTS
- 具有公网 IP

安全组入方向只开放这些端口：

| 端口 | 协议 | 来源 | 用途 |
| --- | --- | --- | --- |
| 22 | TCP | 你的公网 IP/32 | SSH 登录 |
| 80 | TCP | 0.0.0.0/0 | Web 访问 |
| 443 | TCP | 0.0.0.0/0 | HTTPS 预留 |
| 1883 | TCP | 0.0.0.0/0 | 设备 MQTT 连接 |
| 3478 | TCP/UDP | 0.0.0.0/0 | TURN 预留 |

不要公网开放 `3000`、`3001`、`3002`、`5432`、`18083`。

## 2. 安装基础工具

```bash
apt update
apt install -y git ca-certificates curl gnupg
```

## 3. 安装 Docker

优先使用 Docker 官方源：

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

如果官方源下载失败，或者看到 `NO_PUBKEY`、`The repository ... is not signed`、`docker: command not found`，先清理失败的官方源配置，再用系统源：

```bash
rm -f /etc/apt/sources.list.d/docker.list
rm -f /etc/apt/keyrings/docker.asc
apt update
apt install -y docker.io docker-compose-v2
systemctl enable --now docker
```

验证：

```bash
docker --version
docker compose version
```

如果 Docker 已安装，但 `docker compose up -d --build` 拉取镜像时出现 `i/o timeout`、`failed to resolve reference`、`registry-1.docker.io` 超时，说明服务器访问 Docker Hub 不稳定。建议在阿里云控制台打开：

```text
容器镜像服务 ACR -> 镜像工具 -> 镜像加速器
```

复制你的专属加速器地址，然后在服务器执行：

```bash
mkdir -p /etc/docker
nano /etc/docker/daemon.json
```

写入下面内容，把地址替换成阿里云给你的专属地址：

```json
{
  "registry-mirrors": [
    "https://你的专属ID.mirror.aliyuncs.com"
  ],
  "max-concurrent-downloads": 1
}
```

保存后重启 Docker：

```bash
systemctl daemon-reload
systemctl restart docker
docker info | grep -A 10 "Registry Mirrors"
```

然后重新启动服务：

```bash
cd ~/esp32_GardedManagement/deploy
docker compose up -d --build
docker compose ps
```

如果配置镜像加速器后仍出现类似 `postgres:16 not found`，说明当前加速器没有缓存这个镜像。可以在 `.env` 里临时指定可用的镜像代理地址。示例：

```env
POSTGRES_IMAGE=docker.m.daocloud.io/postgres:16
EMQX_IMAGE=docker.m.daocloud.io/emqx/emqx:5
COTURN_IMAGE=docker.m.daocloud.io/coturn/coturn:4
NGINX_IMAGE=docker.m.daocloud.io/nginx:1.27-alpine
NODE_IMAGE=docker.m.daocloud.io/node:22-bookworm-slim
```

更新后重新执行：

```bash
cd ~/esp32_GardedManagement/deploy
docker compose pull postgres emqx coturn nginx
docker compose up -d --build
docker compose ps
```

## 4. 下载代码

```bash
cd ~
git clone https://github.com/wuyongming1984/esp32_GardedManagement.git
cd ~/esp32_GardedManagement/deploy
```

以后更新服务器代码：

```bash
cd ~/esp32_GardedManagement
git pull
```

## 5. 配置环境变量

创建部署用 `.env`：

```bash
cd ~/esp32_GardedManagement/deploy
cp .env.example .env
nano .env
```

没有域名时，先用服务器公网 IP：

```env
POSTGRES_USER=nursery
POSTGRES_PASSWORD=change-to-a-strong-password
POSTGRES_DB=nursery
DATABASE_URL=postgresql://nursery:change-to-a-strong-password@postgres:5432/nursery

JWT_SECRET=change-to-a-long-random-string
MQTT_URL=mqtt://emqx:1883
MQTT_USERNAME=
MQTT_PASSWORD=

TURN_REALM=your-server-public-ip
TURN_SECRET=change-to-a-long-random-string
PUBLIC_APP_URL=http://your-server-public-ip
```

注意：

- `.env` 只放在服务器本地，不要提交到 GitHub。
- `POSTGRES_PASSWORD` 和 `DATABASE_URL` 里的数据库密码必须一致。
- `JWT_SECRET` 和 `TURN_SECRET` 必须使用长随机字符串。

保存 nano：

- `Ctrl + O`
- `Enter`
- `Ctrl + X`

## 6. 启动服务

```bash
cd ~/esp32_GardedManagement/deploy
docker compose up -d --build
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

只看 API 日志：

```bash
docker compose logs -f api
```

只看 MQTT 日志：

```bash
docker compose logs -f emqx
```

## 7. 验证访问

浏览器访问：

```text
http://服务器公网IP
```

服务器本机验证：

```bash
curl -I http://127.0.0.1
docker compose ps
```

如果打不开，依次检查：

```bash
docker compose ps
docker compose logs --tail=100 nginx
docker compose logs --tail=100 api
ss -lntup | grep -E ':80|:1883|:3478'
```

同时确认云服务器安全组已经开放 `80`。

## 8. 设备连接云服务器

设备需要把 MQTT 地址改成服务器公网 IP：

```text
mqtt://服务器公网IP:1883
```

当前固件默认 MQTT 地址仍是本地示例地址，正式部署时需要通过 NVS provisioning 或重新烧录配置写入：

- `device_id`
- `device_secret`
- `mqtt_uri`
- Wi-Fi SSID / 密码

## 9. 更新服务

以后代码更新后，在服务器执行：

```bash
cd ~/esp32_GardedManagement
git pull
cd deploy
docker compose up -d --build
docker compose ps
```

## 10. 停止和重启

停止：

```bash
cd ~/esp32_GardedManagement/deploy
docker compose down
```

重启：

```bash
docker compose restart
```

重新构建：

```bash
docker compose up -d --build
```

## 11. 数据备份

PostgreSQL 数据在 Docker volume `deploy_postgres_data` 中。

备份数据库：

```bash
cd ~/esp32_GardedManagement/deploy
docker compose exec postgres pg_dump -U nursery nursery > nursery-backup.sql
```

恢复数据库前先确认目标环境可以被覆盖。

## 12. 域名和 HTTPS

没有域名时先使用公网 IP + HTTP。

有域名并完成解析后：

1. 将域名 A 记录指向服务器公网 IP。
2. 如果是中国内地服务器，按要求完成 ICP 备案。
3. 申请 HTTPS 证书。
4. 把证书放到 `deploy/certs`。
5. 更新 `deploy/nginx/default.conf` 支持 443 TLS。
6. 修改 `.env`：

```env
TURN_REALM=你的域名
PUBLIC_APP_URL=https://你的域名
```
