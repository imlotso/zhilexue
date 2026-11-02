/**
 * pm2 进程配置 —— 让服务在后台常驻、崩溃自动重启、开机自启
 *
 * 启动：  pm2 start ecosystem.config.js
 * 重启：  pm2 restart xuexi
 * 日志：  pm2 logs xuexi
 * 状态：  pm2 status
 *
 * 说明：登录限流放在进程内存里，instances 固定 1（fork 模式）。
 */
module.exports = {
  apps: [
    {
      name: 'xuexi',
      script: 'src/app.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      max_memory_restart: '800M',
      time: true,
      merge_logs: true,
      out_file: './data/logs/out.log',
      error_file: './data/logs/err.log',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // @storage-script-begin
        // 云存储（可选，教程第 9 步）：不建议手改。在项目目录执行下面命令即可
        //   bash deploy/set-storage.sh          问答式配置（七牛云 / 阿里云 OSS）
        //   bash deploy/set-storage.sh --show   查看当前用的是哪种存储
        //   bash deploy/set-storage.sh --local  改回「存服务器本地硬盘」
        // @storage-script-end
      },
    },
  ],
};
