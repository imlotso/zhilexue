'use strict';
/** 写死的外部服务配置。后台不再提供 AI 配置入口。 */
module.exports = {
  ai: {
    // DeepSeek 先停用，配置留着，需要时把下面三行解开、千问那三行注释掉即可。
    // baseUrl: 'https://api.deepseek.com/v1',
    // model: 'deepseek-chat',
    // apiKey: 'sk-5b9b8145b27442c89dc5560b8136e6c3',
    baseUrl: 'https://ws-ej2r4f7pv39bhrib.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-vl-plus',
    apiKey: 'sk-ws-H.PEDYDMX.Vs3v.MEUCIBwn6NXocgtJGxsGjGrNndsJftWKWED3VMiFGwSRJ3U8AiEA2haSPDiPEFjzxirLYIsF-0zw6MLYZ2VhN0El5KiwqEg',
  },
  oss: {
    region: 'oss-cn-beijing',
    bucket: 'xuexiku',
    accessKeyId: 'LTAI5t79rXujvGq1NUAhvTxh',
    accessKeySecret: '8rnX817z7hj2mWKGqTLgL8B3BllJpu',
  },
};
