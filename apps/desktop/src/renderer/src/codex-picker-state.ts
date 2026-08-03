export interface CodexPickerSelection {
  modelId: string | null;
  reasoningOptionId: string | null;
}

export function selectCodexModel(modelId: string | null): CodexPickerSelection {
  return {
    modelId,
    reasoningOptionId: null,
  };
}

export function resetCodexPicker(): CodexPickerSelection {
  return selectCodexModel(null);
}
