function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (tag: string, msg: string) => console.log(`[${tag}] ${timestamp()} INFO  ${msg}`),
  warn: (tag: string, msg: string) => console.warn(`[${tag}] ${timestamp()} WARN  ${msg}`),
  error: (tag: string, msg: string) => console.error(`[${tag}] ${timestamp()} ERROR ${msg}`),
  separator: () => console.log('─'.repeat(60)),
};
