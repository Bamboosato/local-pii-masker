import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "./config/securityHeaders";

function createPwaPlugin(): Plugin {
  return {
    name: "local-pii-masker-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle).filter(
        (fileName) => !fileName.endsWith(".map"),
      );
      const precacheUrls = [
        "/",
        "/index.html",
        "/manifest.webmanifest",
        "/favicon.svg",
        "/icon-192.svg",
        "/icon-512.svg",
        ...bundleFiles.map((fileName) => `/${fileName}`),
      ];
      const template = readFileSync(
        new URL("./src/pwa/service-worker.template.js.txt", import.meta.url),
        "utf8",
      );
      const buildId = createHash("sha256")
        .update(template)
        .update(JSON.stringify(precacheUrls))
        .digest("hex")
        .slice(0, 12);
      const source = template
        .replace("__PWA_BUILD_ID__", buildId)
        .replace("__PWA_PRECACHE_URLS__", JSON.stringify(precacheUrls));

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source,
      });
    },
  };
}

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
                  allowDevelopmentScripts: isDevelopment,
                  allowDevelopmentSockets: isDevelopment,
                }),
                "http-equiv": "Content-Security-Policy",
              },
              injectTo: "head-prepend",
            },
          ],
        },
      },
      createPwaPlugin(),
    ],
    preview: {
      headers: buildSecurityHeaders(),
    },
    server: {
      headers: buildSecurityHeaders({
        allowDevelopmentScripts: true,
        allowDevelopmentSockets: true,
      }),
    },
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**", "e2e-dev/**"],
      setupFiles: "./vitest.setup.ts",
      css: true,
    },
  };
});
