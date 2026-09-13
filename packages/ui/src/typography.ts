export const UI_TEXT_SIZES = ['compact', 'default', 'large', 'extra-large'] as const;
export type UiTextSize = (typeof UI_TEXT_SIZES)[number];
export const UI_TEXT_SIZE_BASE_PX: Readonly<Record<UiTextSize, number>> = {
  compact: 10,
  default: 12,
  large: 14,
  'extra-large': 16,
};
export function isUiTextSize(value: unknown): value is UiTextSize {
  return UI_TEXT_SIZES.some((size) => size === value);
}
export type UiTypographyMessage = Readonly<{
  type: 'gosu:ui-typography';
  version: 1;
  textSize: UiTextSize;
}>;
export function typographyMessage(textSize: UiTextSize): UiTypographyMessage {
  return { type: 'gosu:ui-typography', version: 1, textSize };
}
export function parseTypographyMessage(value: unknown): UiTypographyMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).sort().join(',') !== 'textSize,type,version' ||
    message.type !== 'gosu:ui-typography' ||
    message.version !== 1 ||
    !isUiTextSize(message.textSize)
  )
    return null;
  return typographyMessage(message.textSize);
}
