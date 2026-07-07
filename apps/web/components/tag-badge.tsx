import { TagItem } from '../lib/api';
import { getTagColor } from '../lib/tags';

type TagBadgeProps = {
  tag: Pick<TagItem, 'name' | 'color'>;
  onRemove?: () => void;
  removable?: boolean;
};

export function TagBadge({ tag, onRemove, removable = false }: TagBadgeProps) {
  const color = getTagColor(tag.color);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white"
      style={{ backgroundColor: color }}
      title={tag.name}
    >
      {tag.name}
      {removable && onRemove ? (
        <button
          className="rounded-full px-1 text-[10px] leading-none opacity-80 hover:opacity-100"
          type="button"
          onClick={onRemove}
          aria-label={`Remover tag ${tag.name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
