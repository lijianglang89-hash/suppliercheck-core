/**
 * server-only 的测试替身。
 *
 * server-only 包在非 React Server Component 环境中 import 会直接抛错（设计如此），
 * 而 Vitest 跑在普通 Node 进程里。vitest.config.ts 把这个路径别名到本文件，
 * 让服务端逻辑可测；生产构建仍然由真实的 server-only 把关。
 */
export {};
