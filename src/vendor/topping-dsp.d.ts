import type { Channel, FilterType, SamplingOptions, TransferFunction } from '../types.ts';
export function normalizeFilterTypeCode(type: string): FilterType;
export function getTransferFunction(
  type: string,
  hz: number,
  gain: number,
  q: number,
  options?: SamplingOptions,
): TransferFunction;
export function calculateFilterResponseDb(
  tf: TransferFunction,
  hz: number,
  options?: SamplingOptions,
): number;
export function calculateCombinedResponseDb(
  filters: Channel['filters'],
  preamp: number,
  hz: number,
  options?: SamplingOptions,
): number;
