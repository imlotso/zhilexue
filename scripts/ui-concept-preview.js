'use strict';
// Isolated static review server. It cannot start the app, connect to MySQL or proxy APIs.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://preview.local');
 if(url.pathname.startsWith('/api/')){res.statusCode=403;return res.end('No application API is available in this isolated UI fixture.');}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>智乐学 UI 开发预览</title><body><h1>智乐学 UI 开发预览</h1><p>这是隔离的合成数据界面，不连接运行站或数据库。</p><ul><li><a href="/fixtures/learning-live.html">学习空间</a></li><li><a href="/fixtures/quiz-desktop.html">答题工作台</a></li><li><a href="/fixtures/review-viewer.html">后台逐题审核</a></li></ul><p>运行 test:ui-concepts:browser 可在独立 Chromium 中复现三尺寸测试和截图。预览 fixture 由交付包提供，不属于生产部署资源。</p></body></html>');}
 const route=url.pathname==='/'?'/fixtures/index.html':decodeURIComponent(url.pathname);
 const base=route.startsWith('/fixtures/')?path.join(root,'evidence/fixtures'):path.join(root,'public');
 const rel=route.startsWith('/fixtures/')?route.slice('/fixtures/'.length):route.slice(1);
 const file=path.resolve(base,rel);
 if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('Not found');}
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.UI_PREVIEW_PORT)||4173,'0.0.0.0',()=>console.log('Isolated UI preview listening on 4173; no application or database loaded.'));
