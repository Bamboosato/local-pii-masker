export function normalizeText(value: string): string {
  return value.normalize("NFC");
}

export function isBlankText(value: string): boolean {
  return normalizeText(value).trim().length === 0;
}
