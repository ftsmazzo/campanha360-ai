import { ContactTagItem } from '../lib/api';

const DEFAULT_COLOR = '#47624f';

export function getTagColor(color: string | null | undefined) {
  if (!color?.trim()) return DEFAULT_COLOR;
  return color.trim();
}

export function getContactTags(contact: { tags: ContactTagItem[] }) {
  return contact.tags.map((item) => ({
    ...item.tag,
    appliedAt: item.createdAt,
  }));
}
