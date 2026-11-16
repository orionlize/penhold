// 形状与笔迹批注的共用定义：工具栏子菜单、图层名称与评论关联共用。
import type { Annotation } from '../../../src/core/types';
import type { IconName } from './icons';
import type { ShapeKind } from '../store';
import { t } from '../i18n';

/** 形状工具的子菜单：形状、图标与快捷键。 */
export const SHAPES: Array<{ kind: ShapeKind; icon: IconName; key?: string }> = [
  { kind: 'rect', icon: 'rect', key: 'R' },
  { kind: 'round', icon: 'roundRect' },
  { kind: 'oval', icon: 'oval', key: 'O' },
  { kind: 'diamond', icon: 'diamond' },
  { kind: 'line', icon: 'segment', key: 'L' },
  { kind: 'arrow', icon: 'line' },
];

/** 形状的显示名。 */
export const shapeName = (k: ShapeKind) => t(`shape.${k}`);

const shapeOf = (n: Pick<Annotation, 'kind'>) => SHAPES.find((x) => x.kind === n.kind);

/** 作为图层显示、可被评论关联的批注：铅笔 / 钢笔笔迹与形状。 */
export const isLayerNote = (n: Pick<Annotation, 'kind'>) => n.kind === 'pen' || n.kind === 'path' || !!shapeOf(n);

/** 列在图层面板中的批注：笔迹与形状，以及便签与批注文字（评论除外）。 */
export const inLayers = (n: Pick<Annotation, 'kind'>) => isLayerNote(n) || n.kind === 'note' || n.kind === 'text';

/** 批注图层名：形状用各自名称，便签 / 文字用工具名，铅笔 / 钢笔为 Drawing。 */
export const noteName = (n: Pick<Annotation, 'kind'>) =>
  shapeOf(n) ? shapeName(n.kind as ShapeKind) : n.kind === 'note' ? t('tool.note') : n.kind === 'text' ? t('tool.text') : t('layers.drawing');

export const noteIcon = (n: Pick<Annotation, 'kind'>): IconName =>
  shapeOf(n)?.icon ?? (n.kind === 'path' ? 'penTool' : n.kind === 'note' ? 'note' : n.kind === 'text' ? 'text' : 'pen');
