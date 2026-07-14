export const MODEL_ASSET_ORIGINS = [
  "https://huggingface.co",
  "https://*.huggingface.co",
  "https://hf.co",
  "https://*.hf.co",
] as const;

const DEVELOPMENT_SOCKET_ORIGINS = [
  "ws://localhost:*",
  "ws://127.0.0.1:*",
] as const;

type ContentSecurityPolicyOptions = {
  allowDevelopmentSockets?: boolean;
  includeFrameAncestors?: boolean;
};

export function buildContentSecurityPolicy(
  options: ContentSecurityPolicyOptions = {},
): string {
  const connectSources = [
    "'self'",
    ...MODEL_ASSET_ORIGINS,
    ...(options.allowDevelopmentSockets ? DEVELOPMENT_SOCKET_ORIGINS : []),
  ];
  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'none'"],
    ["connect-src", ...connectSources],
    ["font-src", "'self'", "data:"],
    ["form-action", "'none'"],
    ["img-src", "'self'", "data:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["script-src", "'self'", "'wasm-unsafe-eval'"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["worker-src", "'self'", "blob:"],
  ];

  if (options.includeFrameAncestors) {
    directives.push(["frame-ancestors", "'none'"]);
  }

  return directives.map((directive) => directive.join(" ")).join("; ");
}

export function buildSecurityHeaders(options: {
  allowDevelopmentSockets?: boolean;
} = {}): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy({
      allowDevelopmentSockets: options.allowDevelopmentSockets,
      includeFrameAncestors: true,
    }),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}
