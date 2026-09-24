export type FilterType = 'PK' | 'LSC' | 'HSC' | 'LP' | 'HP';
export type CurveRole = 'target' | 'source';
export type ChannelName = 'left' | 'right';
export type CurvePoint = [frequencyHz: number, amplitudeDb: number];
export interface Filter {
  type: FilterType;
  enabled: boolean;
  fcHz: number;
  gainDb: number;
  q: number;
}
export interface Channel {
  preampDb: number;
  filters: Filter[];
}
export interface Preset {
  id: string;
  name: string;
  linked: boolean;
  enabled: boolean;
  left: Channel;
  right: Channel;
}
export interface Curve {
  id: string;
  name: string;
  kind?: CurveRole | 'both';
  builtin?: boolean;
  points?: CurvePoint[];
  brand?: string;
  category?: string;
  measurementSystem?: string;
  sourceUrl?: string;
  responseFile?: string;
  pointCount?: number;
}
export interface MeasuredCurve extends Curve {
  points: CurvePoint[];
}
export type LevelMethod = 'band-energy' | 'band-average' | '1k' | 'none';
export interface CurveDisplay {
  method: LevelMethod;
  referenceDb: number;
  minHz: number;
  maxHz: number;
  targetOffsetDb: number;
  sourceOffsetDb: number;
  compensated: boolean;
  includePreamp: boolean;
  rangeDb: number;
}
export interface AutoEqOptions {
  maxBands: number;
  minHz: number;
  maxHz: number;
  maxBoost: number;
  maxCut: number;
  minQ: number;
  maxQ: number;
  smoothing: number;
  shelves: boolean;
  safePreamp: boolean;
}
export interface Workspace {
  version: number;
  presets: Preset[];
  activeId: string;
  curves: MeasuredCurve[];
  targetId: string;
  sourceId: string;
  sampleRate: number;
  curveDisplay: CurveDisplay;
  autoEqOptions: AutoEqOptions;
}
export interface SamplingOptions {
  samplingFrequencyHz?: number;
}
export interface TransferFunction {
  num: number[];
  den: number[];
}
export interface AutoEqRequest {
  source: Pick<MeasuredCurve, 'points'>;
  target: Pick<MeasuredCurve, 'points'>;
  display?: Partial<CurveDisplay>;
  options?: Partial<AutoEqOptions>;
  sampleRate?: number;
}
export interface AutoEqProgress {
  bands: number;
  maxBands: number;
  rmse: number;
}
export interface AutoEqResult extends Channel {
  fit: { before: number; after: number; minHz: number; maxHz: number };
  options: AutoEqOptions;
}
export interface AutoEqContext extends AutoEqRequest {
  source: MeasuredCurve;
  target: MeasuredCurve;
  signature: string;
  scope: string;
}
export type AutoEqMessage =
  | ({ type: 'progress' } & AutoEqProgress)
  | { type: 'result'; result: AutoEqResult }
  | { type: 'error'; message: string };
export type Layers = Record<'target' | 'source' | 'bands' | 'combined' | 'filtered', boolean>;
export interface Point {
  x: number;
  y: number;
}
export interface PlotBounds {
  l: number;
  r: number;
  t: number;
  b: number;
}
export interface CurveReading {
  name: string;
  color: string;
  db: number;
}
export interface NumericSpec {
  key: string;
  element: HTMLElement;
  value: number;
  min: number;
  max: number;
  step: number;
  log?: boolean;
  precision?: number;
}
export interface PopupController {
  update(): void;
  close(returnFocus?: boolean): void;
}
