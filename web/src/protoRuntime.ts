// 播放运行时：与导出 HTML 共用 src/core/protoEngine.ts 中的实现。
import { createProtoEngine } from '../../src/core/protoEngine';
export type { ProtoNav, ProtoRuntime as ProtoRuntimeType } from '../../src/core/protoEngine';

export const { ProtoRuntime } = createProtoEngine();
