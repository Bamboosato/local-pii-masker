import { describe, expect, it } from "vitest";
import { detectIpAddresses } from "./detectIpAddresses";

describe("detectIpAddresses", () => {
  it("IPv4の通常値と境界値を形式候補として検出する", () => {
    const candidates = detectIpAddresses(
      "接続元は192.168.1.10、未指定は0.0.0.0、最大値は255.255.255.255です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "192.168.1.10",
        category: "OTHER",
        source: "regex",
      }),
      expect.objectContaining({ originalText: "0.0.0.0" }),
      expect.objectContaining({ originalText: "255.255.255.255" }),
    ]);
  });

  it("範囲外・桁不足・余分な区切り・先頭ゼロのIPv4を除外する", () => {
    const candidates = detectIpAddresses(
      "不正値は256.1.1.1、1.2.3、1.2.3.4.5、192.168.001.1です。",
    );

    expect(candidates).toEqual([]);
  });

  it("IPv6の完全形式、圧縮形式、ループバックを検出する", () => {
    const candidates = detectIpAddresses(
      "完全形式2001:db8:85a3:0:0:8a2e:370:7334、圧縮形式2001:db8::1、ループバック[::1]です。",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "2001:db8:85a3:0:0:8a2e:370:7334",
      "2001:db8::1",
      "::1",
    ]);
  });

  it("不正なIPv6、時刻、MACアドレスを除外する", () => {
    const candidates = detectIpAddresses(
      "不正値2001:db8:::1、1:2:3:4:5:6:7、時刻10:30:00、MAC 00:11:22:33:44:55です。",
    );

    expect(candidates).toEqual([]);
  });

  it("同一IPアドレスの各出現位置を保持する", () => {
    const sourceText = "接続元192.0.2.1、接続先192.0.2.1";
    const candidates = detectIpAddresses(sourceText);

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ start, end }) => sourceText.slice(start, end))).toEqual(
      ["192.0.2.1", "192.0.2.1"],
    );
  });
});
