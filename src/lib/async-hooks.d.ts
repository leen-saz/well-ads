// Cloudflare Workers provide node:async_hooks with nodejs_compat (wrangler.jsonc); only the part src/lib/usage.ts uses is typed here
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
