import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 纯前端离线应用，不配置任何外部服务地址。
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
  },
});
