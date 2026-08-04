export interface CodexPickerSelection {
  modelId: string | null;
  reasoningOptionId: string | null;
}

export function selectCodexModel(
  modelId: string | null,
  reasoningOptionId: string | null,
): CodexPickerSelection {
  return {
    modelId,
    reasoningOptionId,
  };
}

export function resetCodexPicker(): CodexPickerSelection {
  return selectCodexModel(null, null);
}
