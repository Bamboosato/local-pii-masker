import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "./config/securityHeaders";

export default defineConfig(({ command }) => {
  const isDevelopment = command === "serve";

  return {
    plugins: [
      react(),
      {
        name: "local-pii-masker-csp",
        transformIndexHtml: {
          order: "pre",
          handler: () => [
            {
              tag: "meta",
              attrs: {
                content: buildContentSecurityPolicy({
                  allowDevelopmentSockets: isDevelopment,
                }),
                "http-equiv": "Content-Security-Policy",
              },
              injectTo: "head-prepend",
            },
          ],
        },
      },
    ],
    preview: {
      headers: buildSecurityHeaders(),
    },
    server: {
      headers: buildSecurityHeaders({ allowDevelopmentSockets: true }),
    },
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**"],
      setupFiles: "./vitest.setup.ts",
      css: true,
    },
  };
});
