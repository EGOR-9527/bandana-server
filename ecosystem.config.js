module.exports = {
  apps: [
    {
      name: "bandana-server",
      script: "./index.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        BOT_TOKEN: process.env.BOT_TOKEN,
        ADMINS_ID: process.env.ADMINS_ID,
      }
    }
  ]
};
